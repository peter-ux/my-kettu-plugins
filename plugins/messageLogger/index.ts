/**
 * MessageLogger plugin for Kettu/Bunny
 * - 삭제된 메시지를 AsyncStorage에 영구 저장
 * - 설정에서 채널 ID 입력 시 해당 채널에도 로그 전송
 */

import { storage } from "@vendetta/plugin";
import { findByProps } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";

// ─── 타입 ────────────────────────────────────────────────
interface DeletedMessage {
    id: string;
    channelId: string;
    guildId: string | null;
    authorId: string;
    authorName: string;
    content: string;
    deletedAt: number; // timestamp (ms)
    attachments: { url: string; filename: string }[];
}

// ─── Storage 초기화 ───────────────────────────────────────
// storage는 AsyncStorage를 래핑한 Kettu/Bunny의 영구 저장소
if (!storage.logs) storage.logs = [] as DeletedMessage[];
if (!storage.settings) storage.settings = {
    logChannelId: "",        // 비공개 채널 ID (선택)
    maxLogs: 500,            // 최대 저장 개수
    ignoreBots: true,        // 봇 메시지 무시
    ignoreSelf: false,       // 내 메시지 무시
};

// ─── Discord 내부 모듈 ────────────────────────────────────
const FluxDispatcher = findByProps("dispatch", "subscribe", "_currentDispatchActionType");
const MessageStore   = findByProps("getMessage", "getMessages");
const UserStore      = findByProps("getCurrentUser", "getUser");
const RestAPI        = findByProps("getAPIBaseURL"); // REST 요청용

// ─── 유틸 ─────────────────────────────────────────────────
function getMaxLogs(): number {
    return storage.settings.maxLogs ?? 500;
}

function trimLogs() {
    const max = getMaxLogs();
    const logs: DeletedMessage[] = storage.logs;
    if (logs.length > max) {
        storage.logs = logs.slice(logs.length - max);
    }
}

/** 비공개 채널에 메시지 전송 (설정된 경우) */
async function sendToLogChannel(msg: DeletedMessage) {
    const channelId: string = storage.settings.logChannelId?.trim();
    if (!channelId) return;

    const time = new Date(msg.deletedAt).toLocaleString();
    const attachmentInfo = msg.attachments.length > 0
        ? `\n📎 첨부파일: ${msg.attachments.map(a => a.url).join(", ")}`
        : "";

    const content =
        `🗑️ **삭제된 메시지** (${time})\n` +
        `👤 **유저**: <@${msg.authorId}> (${msg.authorName})\n` +
        `📍 **채널**: <#${msg.channelId}>\n` +
        `💬 **내용**: ${msg.content || "*(내용 없음)*"}` +
        attachmentInfo;

    try {
        // Kettu/Bunny 환경에서 REST API 호출
        const http = findByProps("post", "get", "patch", "delete");
        await http.post({
            url: `/channels/${channelId}/messages`,
            body: { content: content.slice(0, 2000) }, // Discord 글자 제한
        });
    } catch (e) {
        console.error("[MessageLogger] 채널 전송 실패:", e);
    }
}

// ─── 메시지 삭제 핸들러 ───────────────────────────────────
let unsubscribe: (() => void) | null = null;

function handleMessageDelete({ id, channelId }: { id: string; channelId: string }) {
    try {
        const message = MessageStore.getMessage(channelId, id);
        if (!message) return;

        const me = UserStore.getCurrentUser();
        const settings = storage.settings;

        // 봇 무시
        if (settings.ignoreBots && message.author?.bot) return;
        // 본인 무시
        if (settings.ignoreSelf && message.author?.id === me?.id) return;

        const deleted: DeletedMessage = {
            id: message.id,
            channelId,
            guildId: message.guild_id ?? null,
            authorId: message.author?.id ?? "unknown",
            authorName: message.author?.username ?? "unknown",
            content: message.content ?? "",
            deletedAt: Date.now(),
            attachments: (message.attachments ?? []).map((a: any) => ({
                url: a.url,
                filename: a.filename,
            })),
        };

        // AsyncStorage에 저장
        (storage.logs as DeletedMessage[]).push(deleted);
        trimLogs();

        // 비공개 채널에 전송 (설정된 경우)
        sendToLogChannel(deleted);

        showToast(`🗑️ 메시지 기록됨: ${deleted.authorName}`, { key: "msglog" });
    } catch (e) {
        console.error("[MessageLogger] 오류:", e);
    }
}

// ─── 플러그인 진입점 ──────────────────────────────────────
export default {
    onLoad() {
        FluxDispatcher.subscribe("MESSAGE_DELETE", handleMessageDelete);
        console.log("[MessageLogger] 로드됨");
    },

    onUnload() {
        FluxDispatcher.unsubscribe("MESSAGE_DELETE", handleMessageDelete);
        console.log("[MessageLogger] 언로드됨");
    },

    /** 저장된 로그 전체 반환 */
    getLogs(): DeletedMessage[] {
        return storage.logs ?? [];
    },

    /** 로그 초기화 */
    clearLogs() {
        storage.logs = [];
        showToast("로그가 초기화됐어요.");
    },

    /** 설정 getter/setter */
    getSettings() {
        return storage.settings;
    },

    updateSettings(patch: Partial<typeof storage.settings>) {
        storage.settings = { ...storage.settings, ...patch };
    },
};
