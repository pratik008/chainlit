import { makeApiClient } from 'api';
import { useEffect, useState } from 'react';
import { RecoilRoot } from 'recoil';
import { IWidgetConfig } from 'types';
import { v4 as uuidv4 } from 'uuid';

import { i18nSetupLocalization } from '@chainlit/app/src/i18n';
import { ChainlitContext, ICallFn } from '@chainlit/react-client';

import App from './app';

i18nSetupLocalization();

const pendingCopilotCallbacks = new Map<string, (payload: any) => void>();

interface Props {
  widgetConfig: IWidgetConfig;
}

export default function AppWrapper({ widgetConfig }: Props) {
  const additionalQueryParams = widgetConfig?.additionalQueryParamsForAPI;
  const apiClient = makeApiClient(
    widgetConfig.chainlitServer,
    additionalQueryParams || {}
  );
  const [customThemeLoaded, setCustomThemeLoaded] = useState(false);

  function completeInitialization() {
    if (widgetConfig.customCssUrl) {
      const linkEl = document.createElement('link');
      linkEl.rel = 'stylesheet';
      linkEl.href = widgetConfig.customCssUrl;
      const shadowRoot =
        document.getElementById('chainlit-copilot')?.shadowRoot;
      if (shadowRoot) {
        shadowRoot.appendChild(linkEl);
      } else if (window.cl_shadowRootElement) {
        window.cl_shadowRootElement.getRootNode().appendChild(linkEl);
      }
    }
    setCustomThemeLoaded(true);
  }

  useEffect(() => {
    let fontLoaded = false;
    apiClient
      .get('/public/theme.json')
      .then(async (res) => {
        try {
          const customTheme = await res.json();
          if (customTheme.custom_fonts?.length) {
            fontLoaded = true;
            customTheme.custom_fonts.forEach((href: string) => {
              const linkEl = document.createElement('link');
              linkEl.rel = 'stylesheet';
              linkEl.href = href;
              const shadowRoot =
                document.getElementById('chainlit-copilot')?.shadowRoot;
              if (shadowRoot) {
                shadowRoot.appendChild(linkEl);
              } else if (window.cl_shadowRootElement) {
                window.cl_shadowRootElement.getRootNode().appendChild(linkEl);
              }
            });
          }
          if (customTheme.variables) {
            window.theme = customTheme.variables;
          }
        } finally {
          if (!fontLoaded) {
            const linkEl = document.createElement('link');
            linkEl.rel = 'stylesheet';
            linkEl.href =
              'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap';
            const shadowRoot =
              document.getElementById('chainlit-copilot')?.shadowRoot;
            if (shadowRoot) {
              shadowRoot.appendChild(linkEl);
            } else if (window.cl_shadowRootElement) {
              window.cl_shadowRootElement.getRootNode().appendChild(linkEl);
            }
          }
          completeInitialization();
        }
      })
      .catch(() => completeInitialization());
  }, [apiClient, widgetConfig.customCssUrl]);

  useEffect(() => {
    const handleCopilotResponseFromParent = (event: MessageEvent) => {
      const data = event.data;
      if (data && data.type === 'copilot_function_response' && data.callId) {
        console.log(
          'CHAINLIT_COPILOT_WIDGET (AppWrapper): Received copilot_function_response from parent (LWC):',
          data
        );
        if (pendingCopilotCallbacks.has(data.callId)) {
          const callback = pendingCopilotCallbacks.get(data.callId)!;
          let responsePayload = {};
          if (data.result !== undefined)
            responsePayload = { result: data.result };
          else if (data.error !== undefined)
            responsePayload = { error: data.error };
          else responsePayload = { result: null };
          callback(responsePayload);
          pendingCopilotCallbacks.delete(data.callId);
        } else {
          console.warn(
            `CHAINLIT_COPILOT_WIDGET (AppWrapper): No pending callback for copilot_function_response callId: ${data.callId}`
          );
        }
      }
    };

    const handleInternalChainlitCallFn = (event: CustomEvent<ICallFn>) => {
      console.log(
        'CHAINLIT_COPILOT_WIDGET (AppWrapper): CustomEvent chainlit-call-fn received:',
        event.detail
      );
      const { name, args, callback } = event.detail;
      const callId = uuidv4();

      pendingCopilotCallbacks.set(callId, callback);
      console.log(
        `CHAINLIT_COPILOT_WIDGET (AppWrapper): Stored backend callback for callId: ${callId}`
      );

      const messageToLWC = {
        type: 'copilot_function_call',
        call: { id: callId, name: name, args: args }
      };

      const targetOrigin = widgetConfig.lwcParentOrigin || '*';

      console.log(
        `CHAINLIT_COPILOT_WIDGET (AppWrapper): Posting message to parent (LWC):`,
        messageToLWC,
        `Target Origin: ${targetOrigin}`
      );
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(messageToLWC, targetOrigin);
      } else {
        console.warn(
          'CHAINLIT_COPILOT_WIDGET (AppWrapper): No parent window found. CopilotFunction call will not be sent.'
        );
        pendingCopilotCallbacks.delete(callId);
      }
    };

    window.addEventListener('message', handleCopilotResponseFromParent);
    window.addEventListener(
      'chainlit-call-fn',
      handleInternalChainlitCallFn as EventListener
    );

    return () => {
      window.removeEventListener('message', handleCopilotResponseFromParent);
      window.removeEventListener(
        'chainlit-call-fn',
        handleInternalChainlitCallFn as EventListener
      );
      pendingCopilotCallbacks.clear();
    };
  }, [widgetConfig.lwcParentOrigin]);

  if (!customThemeLoaded) return null;

  return (
    <ChainlitContext.Provider value={apiClient}>
      <RecoilRoot>
        <App widgetConfig={widgetConfig} />
      </RecoilRoot>
    </ChainlitContext.Provider>
  );
}
