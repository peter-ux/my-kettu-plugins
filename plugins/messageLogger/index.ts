import { storage } from "@vendetta/plugin";
import { findByProps } from "@vendetta/metro";
import { showToast } from "@vendetta/ui/toasts";

if (!storage.logs) storage.logs = [];
if (!storage.settings) storage.settings = {
    logChannelId: "",
    maxLogs: 500,
    ignoreBots: true,
    ignoreSelf: false,
};

const FluxDispatcher = findByProps("dispatch", "subscribe", "_currentDispatchActionType");
const MessageStore = findByProps("getMessage", "getMessages");
const UserStore = findByProps("getCurrentUser", "getUser");

function trimLogs() {
    const max = storage.settings.maxLogs ?? 500;
    if (storage.logs.length > max) {
        storage.logs = storage.logs.slice(storage.logs.length - max);
    }
}

async function sendToLogChannel(msg: any) {
    const channelId = storage.settings.logChannelId?.trim();
    if (!channelId) return;
    const http = findByProps("post", "get", "patch");
    const content = `🗑️ **삭제된 메시지**\n👤 <@${msg.authorId}> (${msg.authorName})\n📍 <#${msg.channelId}>\n💬 ${msg.content || "*(내용 없음)*"}`;
    try {
        await http.post({ url: `/channels/${channelId}/messages`, body: { content: content.slice(0, 2000) } });
    } catch (e) {
        console.error("[MessageLogger] 채널 전송 실패:", e);
    }
}

function handleDelete({ id, channelId }: { id: string; channelId: string }) {
    try {
        const message = MessageStore.getMessage(channelId, id);
        if (!message) return;
        const me = UserStore.getCurrentUser();
        if (storage.settings.ignoreBots && message.author?.bot) return;
        if (storage.settings.ignoreSelf && message.author?.id === me?.id) return;

        const entry = {
            id: message.id,
            channelId,
            guildId: message.guild_id ?? null,
            authorId: message.author?.id ?? "unknown",
            authorName: message.author?.username ?? "unknown",
            content: message.content ?? "",
            deletedAt: Date.now(),
        };

        storage.logs.push(entry);
        trimLogs();
        sendToLogChannel(entry);
        showToast(`🗑️ 기록됨: ${entry.authorName}`);
    } catch (e) {
        console.error("[MessageLogger] 오류:", e);
    }
}

export function onLoad() {
    FluxDispatcher.subscribe("MESSAGE_DELETE", handleDelete);
}

export function onUnload() {
    FluxDispatcher.unsubscribe("MESSAGE_DELETE", handleDelete);
}
