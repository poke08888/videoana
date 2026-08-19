// server/studio/engines/types.ts — hợp đồng cho 3 lớp engine cắm-rút.
export interface FileRef { path: string; mimeType: string }
export interface WordTiming { text: string; startSec: number; endSec: number }
export type AspectRatio = "9:16" | "16:9" | "1:1";
export interface ImageRequest { prompt: string; refs: FileRef[]; aspectRatio: AspectRatio; size: "1K" | "2K"; outPath: string }
export interface ImageResult { path: string; mimeType: string; costUsd: number; model: string }
export interface ImageEngine { name: string; generate(req: ImageRequest): Promise<ImageResult> }
export interface VideoRequest { prompt: string; firstFrame: FileRef; durationSec: 4 | 6 | 8; aspectRatio: AspectRatio; tier: "draft" | "final"; motionLevel: "low" | "medium" | "high"; outPath: string }
export interface VideoResult { path: string; durationSec: number; costUsd: number; model: string }
export interface VideoEngine { name: string; generate(req: VideoRequest): Promise<VideoResult> }
export interface VoiceRequest { text: string; voice: string; rate: number; outPath: string }   // rate 1.0 = bình thường
export interface VoiceResult { path: string; durationSec: number; words: WordTiming[] | null; costUsd: number }
export interface VoiceEngine { name: string; voices(): { id: string; label: string }[]; synthesize(req: VoiceRequest): Promise<VoiceResult> }
export interface Engines { image: ImageEngine; video: VideoEngine; voice: VoiceEngine }
