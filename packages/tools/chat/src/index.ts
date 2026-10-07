// @ueberblick/tool-chat: loaded lazily by the app, which builds the tool once the device can name people and features:
//   chat: () => import('@ueberblick/tool-chat').then((m) => m.createChatTool({ self, nameOf, people, featureLabel, seed }))
export { createChatTool } from './chat-tool';
export type { ChatDeps, ChatPerson, ChatSeed } from './chat-tool';
