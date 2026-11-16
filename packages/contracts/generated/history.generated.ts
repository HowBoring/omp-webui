// Generated from same-source native history wire.
import command from "./history-command.js";
import type { HistoryCommand } from "./history-client";
import type { HistoryOpen,HistoryPage,HistoryPoll,HistoryContentPage,AvailableCommandsUpdateEvent,RpcWireCommands } from "./omp-wire";
export const validateHistoryCommand = (value:unknown):value is HistoryCommand | ({id:string;type:"negotiate_protocol"}&RpcWireCommands["negotiate_protocol"]["params"]) => command(value);
import open from "./history-open.js";
export const validHistoryOpen = (value:unknown):value is HistoryOpen => open(value);
import page from "./history-page.js";
export const validHistoryPage = (value:unknown):value is HistoryPage => page(value);
import poll from "./history-poll.js";
export const validHistoryPoll = (value:unknown):value is HistoryPoll => poll(value);
import content from "./history-content.js";
export const validHistoryContent = (value:unknown):value is HistoryContentPage => content(value);
import notification from "./history-notification.js";
export const validHistoryNotification = (value:unknown):value is AvailableCommandsUpdateEvent => notification(value);
