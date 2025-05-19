feat(copilot): Enhance widget and server for Salesforce LWC integration

    This commit introduces necessary modifications to the Chainlit backend
    and the copilot widget to support robust two-way communication when
    embedded within a Salesforce Lightning Web Component (LWC).

    Key changes:

    - `backend/chainlit/server.py`:
        - Updated CORSMiddleware configuration to explicitly allow origins
          for the LWC environment and the intermediary copilot loader
          (e.g., `http://localhost:8001`).
        - Ensured `allow_credentials=True` is correctly paired with specific
          origins (not wildcard) to resolve CORS issues encountered when the
          widget fetches initial resources (theme, config) from within the
          loader iframe.

    - `libs/copilot/src/appWrapper.tsx`:
        - Introduced `postMessage`-based communication for CopilotFunctions
          to interact with the parent LWC environment.
        - Added `handleInternalChainlitCallFn`:
            - Listens for the internal `chainlit-call-fn` custom event.
            - Generates a unique `callId` for tracking.
            - Forwards the function call (name, args, callId) to the parent
              window (LWC) using `window.parent.postMessage`.
            - Critically, uses `widgetConfig.lwcParentOrigin` (the LWC's actual
              origin) as the `targetOrigin` for secure and correct message delivery.
        - Added `handleCopilotResponseFromParent` listener:
            - Listens for `message` events on its window (which is the loader's window).
            - Processes `copilot_function_response` messages sent from the LWC
              (originating from the LWC and targeted at the loader's window).
            - Uses `callId` from the response to invoke the correct pending callback,
              completing the asynchronous communication loop.
        - Implemented `pendingCopilotCallbacks` Map to manage asynchronous callbacks.
        - Included diagnostic logging for `targetOrigin` and parent window properties.
        - Enhanced try-catch block for `window.parent.location.href` access
          to satisfy linter requirements.

    - `libs/copilot/pnpm-lock.yaml`:
        - Updated lockfile reflecting dependency versions. Committing this
          ensures reproducible builds for the copilot library.

    These changes are essential for the Chainlit copilot to function correctly
    when hosted in a cross-origin iframe setup, particularly within the
    security constraints of the Salesforce LWC environment, enabling
    CopilotFunctions to be handled by LWC logic.