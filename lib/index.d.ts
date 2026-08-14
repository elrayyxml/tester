export interface ExtendOptions {
  bot?: (id: string) => boolean
  stealth?: 'ios' | 'android' | 'web' | 'desktop'
  messageIdPrefix?: string
  updateProtoOnStartup?: boolean
  autoFollowNewsletter?: string | string[] | false
  newsletterAnnotation?: { newsletterJid: string; newsletterName?: string; contentType?: number } | false
  linkPreview?: boolean
  logger?: { error?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void; debug?: (...args: unknown[]) => void }
  onMessage?: (message: SerializedMessage, event?: unknown) => unknown
  [key: string]: unknown
}

export interface SerializedMessage {
  key: Record<string, unknown>
  id?: string
  chat: string
  sender: string
  senderLid?: string
  body: string
  isGroup: boolean
  isPrivate: boolean
  isBot: boolean
  device: string
  reply(text: string, options?: Record<string, unknown>): Promise<unknown>
  react(emoji: string): Promise<unknown>
  [key: string]: unknown
}

export class ElrayyxmlError extends Error { code: string; statusCode?: number }
export const NexrayError: typeof ElrayyxmlError
export function Client<T extends object>(sock: T, options?: ExtendOptions): T
export function Extend<T extends object>(sock: T, options?: ExtendOptions): Promise<T>
export function serialize(sock: unknown, message: unknown, options?: ExtendOptions): SerializedMessage
export const Utils: Record<string, (...args: any[]) => any> & { extend(map: Record<string, Function>): typeof Utils }
export function getGlobalConfig(): Record<string, unknown>
export function setGlobalConfig(partial: Record<string, unknown>): Record<string, unknown>
export function relayHelper(...args: any[]): Promise<any>
export function buildWAMessage(...args: any[]): Promise<any>
export function getBaileys(sock?: unknown): any
export function makeInteractiveContent(buttons?: any[], options?: Record<string, unknown>): any
export function decodeAudioMetadata(buffer: Buffer): Promise<Record<string, unknown> | undefined>
export function isNewsletterJid(jid: string): boolean
export function bindMessageListener(sock: unknown, options?: ExtendOptions): unknown
export function bindChatListeners(sock: unknown, options?: ExtendOptions): unknown
export function bindNewsletterListeners(sock: unknown, options?: ExtendOptions): unknown
export function newsletterFollow(sock: unknown, jid: string): Promise<unknown>
export function newsletterUnfollow(sock: unknown, jid: string): Promise<unknown>
