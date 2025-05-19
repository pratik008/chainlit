import { useEffect } from 'react';

import { IStep, useChatInteract, useChatSession } from '@chainlit/react-client';

import ChatBody from './body';

export default function ChatWrapper() {
  const { connect, session } = useChatSession();
  const { sendMessage, windowMessage } = useChatInteract();

  useEffect(() => {
    if (session?.socket?.connected) return;
    connect({
      // @ts-expect-error window typing
      transports: window.transports,
      userEnv: {}
    });
  }, [connect, session?.socket?.connected]);

  useEffect(() => {
    // Expose sendChainlitMessage for parent to call into the chat
    // @ts-expect-error (Property 'sendChainlitMessage' does not exist on type 'Window & typeof globalThis')
    window.sendChainlitMessage = (message: IStep) => sendMessage(message);

    // Listener for general messages from LWC parent (e.g., lwc_ready_ping)
    // This relays them to the Python backend.
    const handleGenericMessageFromParent = (event: MessageEvent) => {
      const data = event.data;
      // Avoid processing the copilot_function_response here again,
      // as AppWrapper specifically handles that.
      if (data && data.type !== 'copilot_function_response') {
        console.log(
          'CHAINLIT_COPILOT_WIDGET (ChatWrapper): Received generic message from parent:',
          data
        );
        windowMessage(data); // Relay to backend via socket
      }
    };
    window.addEventListener('message', handleGenericMessageFromParent);

    return () => {
      // @ts-expect-error (Property 'sendChainlitMessage' does not exist on type 'Window & typeof globalThis')
      window.sendChainlitMessage = () =>
        console.info(
          'Copilot widget not active or unmounted (sendChainlitMessage).'
        );
      window.removeEventListener('message', handleGenericMessageFromParent);
    };
  }, [sendMessage, windowMessage]);

  return <ChatBody />;
}
