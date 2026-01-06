
export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  attendee: string;
}

export enum AppTab {
  VOICE = 'voice',
  CHAT = 'chat',
  VIDEO = 'video',
  HISTORY = 'history'
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  groundingLinks?: { title: string; uri: string }[];
}
