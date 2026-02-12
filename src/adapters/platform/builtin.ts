import type { PlatformAdapterDescriptor } from "./types";

export const OPEN_CODE_ADAPTER: PlatformAdapterDescriptor = {
	name: "opencode",
	version: "1.0",
	capabilities: {
		nativeSessionLifecycle: true,
		nativeToolCapture: true,
		nativeChatCapture: true,
		emulatedIdleFlush: false,
	},
};

export const CLAUDE_CODE_ADAPTER: PlatformAdapterDescriptor = {
	name: "claude-code",
	version: "0.1",
	capabilities: {
		nativeSessionLifecycle: true,
		nativeToolCapture: true,
		nativeChatCapture: true,
		emulatedIdleFlush: true,
	},
};

export const CURSOR_ADAPTER: PlatformAdapterDescriptor = {
	name: "cursor",
	version: "0.1",
	capabilities: {
		nativeSessionLifecycle: false,
		nativeToolCapture: true,
		nativeChatCapture: true,
		emulatedIdleFlush: true,
	},
};

export const BUILTIN_PLATFORM_ADAPTERS: PlatformAdapterDescriptor[] = [
	OPEN_CODE_ADAPTER,
	CLAUDE_CODE_ADAPTER,
	CURSOR_ADAPTER,
];
