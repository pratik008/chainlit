import getRouterBasename from '@/lib/router';
import App from 'App';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';

import {
  ICallFn,
  useApi,
  useAuth,
  useChatInteract,
  useConfig
} from '@chainlit/react-client';

import {
  CopilotCallPayload,
  CopilotFunctionCallMessage
} from './types/lwcIntegrationTypes';
// Corrected path
import { LwcToChainlitMessage } from './types/lwcIntegrationTypes';

// Corrected path

// Define chainlitWidgetConfig on the window type for TypeScript
declare global {
  interface Window {
    chainlitWidgetConfig?: {
      lwcParentOrigin?: string;
      chainlitServer?: string;
    };
  }
}

// Store for pending callbacks from cl.CopilotFunction calls
const pendingChainlitLwcCallbacks = new Map<string, (payload: any) => void>();

export default function AppWrapper() {
  const [translationLoaded, setTranslationLoaded] = useState(false);
  const { isAuthenticated, isReady } = useAuth();
  const { language: languageInUse } = useConfig();
  const { i18n } = useTranslation();
  const { windowMessage } = useChatInteract();

  // Ref to store LWC parent origin once determined
  const lwcParentOriginRef = useRef<string | null>(null);

  function handleChangeLanguage(languageBundle: any): void {
    i18n.addResourceBundle(languageInUse, 'translation', languageBundle);
    i18n.changeLanguage(languageInUse);
  }

  const { data: translations } = useApi<any>(
    `/project/translations?language=${languageInUse}`
  );

  useEffect(() => {
    if (!translations) return;
    handleChangeLanguage(translations.translation);
    setTranslationLoaded(true);
  }, [translations]);

  // Effect to determine LWC parent origin from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const detectedLwcParentOrigin = params.get('lwcParentOrigin');

    if (detectedLwcParentOrigin) {
      lwcParentOriginRef.current = detectedLwcParentOrigin;
      console.log(
        '[Main AppWrapper] LWC Parent Origin detected from URL:',
        detectedLwcParentOrigin
      );
      // Optionally set it on window.chainlitWidgetConfig if other parts of your system use it
      if (!window.chainlitWidgetConfig) window.chainlitWidgetConfig = {};
      window.chainlitWidgetConfig.lwcParentOrigin = detectedLwcParentOrigin;
    } else {
      console.warn(
        '[Main AppWrapper] lwcParentOrigin not found in URL parameters. Two-way LWC communication (cl.CopilotFunction) might not work correctly.'
      );
    }
    // No dependencies, so this runs once on mount.
  }, []);

  // Original useEffect for general window messages (e.g., context updates from LWC)
  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent) => {
      // We will add more specific handling for 'copilot_function_response' in the next effect.
      // This current handler can remain for other general messages.
      // Check origin if lwcParentOriginRef.current is set, to avoid processing other iframe messages.
      if (
        lwcParentOriginRef.current &&
        event.origin !== lwcParentOriginRef.current
      ) {
        // console.log('[Main AppWrapper] Ignoring message from unexpected origin:', event.origin);
        return;
      }
      // Pass data to existing windowMessage handler from useChatInteract for general messages.
      // Ensure this doesn't conflict with copilot_function_response handling.
      if (event.data?.type !== 'copilot_function_response') {
        windowMessage(event.data);
      }
    };
    window.addEventListener('message', handleWindowMessage);
    return () => window.removeEventListener('message', handleWindowMessage);
  }, [windowMessage]); // windowMessage is from useChatInteract

  // --- New useEffect for CopilotFunction bridge ---
  useEffect(() => {
    const handleInternalChainlitCallFn = (event: CustomEvent<ICallFn>) => {
      console.log(
        '[Main AppWrapper] CustomEvent chainlit-call-fn received:',
        event.detail
      );
      const { name, args, callback } = event.detail;
      const callId = uuidv4(); // Generate a unique ID for this call

      pendingChainlitLwcCallbacks.set(callId, callback);
      console.log(
        `[Main AppWrapper] Stored backend callback for LWC callId: ${callId}`
      );

      const callPayload: CopilotCallPayload = {
        id: callId,
        name: name,
        args: args
      };
      const messageToLWC: CopilotFunctionCallMessage = {
        type: 'copilot_function_call', // This will now be type-checked
        call: callPayload
      };

      const targetOrigin = lwcParentOriginRef.current || '*'; // Default to * if not set, with a warning already issued

      console.log(
        `[Main AppWrapper] Preparing to post message to LWC parent. Target Origin: ${targetOrigin}`,
        messageToLWC
      );

      if (window.parent && window.parent !== window) {
        window.parent.postMessage(messageToLWC, targetOrigin);
        console.log(
          `[Main AppWrapper] postMessage 'copilot_function_call' to LWC parent has been called.`
        );
      } else {
        console.warn(
          '[Main AppWrapper] No parent window found or window.parent is self. CopilotFunction call will not be sent.'
        );
        pendingChainlitLwcCallbacks.delete(callId);
        // Immediately callback with an error so the backend doesn't hang
        callback({ error: 'Cannot communicate with LWC parent window.' });
      }
    };

    const handleLwcResponse = (event: MessageEvent) => {
      // Ensure the message is from the LWC parent if its origin is known
      if (
        lwcParentOriginRef.current &&
        event.origin !== lwcParentOriginRef.current
      ) {
        return; // Not from the expected LWC parent
      }

      const data = event.data as LwcToChainlitMessage; // Type assertion

      if (data && data.type === 'copilot_function_response' && data.callId) {
        console.log(
          `[Main AppWrapper] Received 'copilot_function_response' from LWC parent:`,
          data
        );
        if (pendingChainlitLwcCallbacks.has(data.callId)) {
          const callback = pendingChainlitLwcCallbacks.get(data.callId)!;
          let responsePayload = {};
          if (data.result !== undefined) {
            responsePayload = { result: data.result };
          } else if (data.error !== undefined) {
            responsePayload = { error: data.error };
          } else {
            // If LWC sends neither, default to a null result to fulfill the callback
            responsePayload = { result: null };
          }
          callback(responsePayload);
          pendingChainlitLwcCallbacks.delete(data.callId);
        } else {
          console.warn(
            `[Main AppWrapper] No pending callback for LWC copilot_function_response callId: ${data.callId}`
          );
        }
      }
    };

    // Listen for calls from the Chainlit backend (via cl.CopilotFunction)
    window.addEventListener(
      'chainlit-call-fn',
      handleInternalChainlitCallFn as EventListener
    );
    // Listen for responses from the LWC parent
    window.addEventListener('message', handleLwcResponse);

    return () => {
      window.removeEventListener(
        'chainlit-call-fn',
        handleInternalChainlitCallFn as EventListener
      );
      window.removeEventListener('message', handleLwcResponse);
      pendingChainlitLwcCallbacks.clear(); // Clear any pending callbacks on unmount
    };
  }, []); // Empty dependency array: sets up listeners once on mount. lwcParentOriginRef.current is stable after its own effect.

  if (!translationLoaded) return null;

  if (
    isReady &&
    !isAuthenticated &&
    window.location.pathname !== getRouterBasename() + '/login' &&
    window.location.pathname !== getRouterBasename() + '/login/callback'
  ) {
    window.location.href = getRouterBasename() + '/login';
  }
  return <App />;
}
