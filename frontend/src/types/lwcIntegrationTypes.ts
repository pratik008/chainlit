export interface CopilotCallPayload {
  id: string;
  name: string;
  args: any; // Or a more specific type if args have a consistent structure
}

export interface CopilotFunctionCallMessage {
  type: 'copilot_function_call'; // String literal type
  call: CopilotCallPayload;
}

export interface CopilotFunctionResponseMessage {
  type: 'copilot_function_response'; // String literal type
  callId: string;
  result?: any; // Type this more specifically if possible
  error?: any; // Type this more specifically if possible
}

// You might also want a union type for messages from LWC
export type LwcToChainlitMessage = CopilotFunctionResponseMessage;

// And for messages to LWC
export type ChainlitToLwcMessage = CopilotFunctionCallMessage;
