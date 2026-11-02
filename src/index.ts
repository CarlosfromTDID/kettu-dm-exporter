/**
 * DMChatExporter para Kettu / Bunny / Revenge / Vendetta (Discord Mobile)
 * Descarga un chat de MD o Grupo MD de principio a fin (o hasta el último pin),
 * con o sin imágenes subidas al chat, ignorando por completo las previsualizaciones
 * de sitios web (`message.embeds` y enlaces externos), en formato JSON, TXT o Markdown.
 */

declare const vendetta: any;

const { metro, commands, plugin, ui, logger } = vendetta;
const { findByProps, findByStoreName } = metro;
const { React, ReactNative } = metro.common;
const { registerCommand } = commands;
const { storage } = plugin;
const { showToast } = ui.toasts;
const { Forms, General } = ui.components;

const { ScrollView } = General;
const { FormSection, FormRow, FormSwitchRow, FormDivider } = Forms;

storage.format ??= "txt"; // "txt" | "json" | "md"
storage.includeImages ??= true;
storage.onlyImages ??= true;
storage.ignoreWebPreviews ??= true; // Bloquea embeds y links de sitios externos
storage.rangeMode ??= "all"; // "all" | "to_last_pin" | "only_pins"
storage.batchDelayMs ??= 450;
storage.allowServers ??= false;
storage.lastExportSummary ??= "Ninguna exportación realizada aún.";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;
const ALLOWED_DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

export function isGenuineDiscordAttachment(att: any, strictCdn = true): boolean {
    if (!att || typeof att.url !== "string" || !att.id || !att.filename) return false;
    if (!strictCdn) return true;
    try {
        const parsed = new URL(att.url);
        if (parsed.protocol !== "https:") return false;
        if (!ALLOWED_DISCORD_CDN_HOSTS.has(parsed.hostname.toLowerCase())) return false;
        // Solo permitir archivos realmente subidos al canal (/attachments/), nunca /external/ de sitios web
        if (!parsed.pathname.startsWith("/attachments/")) return false;
        return true;
    } catch {
        return false;
    }
}

export function isImageAttachment(att: any): boolean {
    if (att?.content_type) {
        return String(att.content_type).toLowerCase().startsWith("image/");
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test(att?.filename || att?.url || "");
}

function getStores() {
    const ChannelStore = findByStoreName("ChannelStore") || findByProps("getChannel", "getDMFromUserId");
    const SelectedChannelStore = findByStoreName("SelectedChannelStore") || findByProps("getChannelId", "getVoiceChannelId");
    const UserStore = findByStoreName("UserStore") || findByProps("getCurrentUser", "getUser");
    const RestAPI = findByProps("get", "post", "put", "del", "patch") || metro.common?.RestAPI;
    const Clipboard = findByProps("setString", "getString") || ReactNative?.Clipboard;
    return { ChannelStore, SelectedChannelStore, UserStore, RestAPI, Clipboard };
}

function formatDateReadable(iso: string): string {
    try {
        const d = new Date(iso);
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    } catch {
        return iso;
    }
}

function getChannelDisplayName(channel: any, UserStore: any): string {
    if (!channel) return "MD_Desconocido";
    if (channel.type === CHANNEL_TYPE_DM) {
        const recipientId = channel.recipients?.[0];
        const u = recipientId ? UserStore?.getUser?.(recipientId) : null;
        return u?.globalName || u?.username || channel.name || `MD_${channel.id}`;
    }
    if (channel.type === CHANNEL_TYPE_GROUP_DM) {
        if (channel.name) return channel.name;
        const names = (channel.recipients || [])
            .map((id: string) => {
                const u = UserStore?.getUser?.(id);
                return u?.globalName || u?.username || id;
            })
            .join(", ");
        return names ? `Grupo_${names}` : `Grupo_${channel.id}`;
    }
    return channel.name || `Canal_${channel.id}`;
}

export function formatMessagesForExport(
    messages: any[],
    channel: any,
    channelName: string,
    format: "txt" | "json" | "md",
    includeImages: boolean,
    onlyImages: boolean,
    ignoreWebPreviews = true
): string {
    const exportedAt = new Date().toISOString();

    // Filtra exclusivamente `m.attachments` reales subidos a Discord; ignora `m.embeds` (previews de links web)
    const filterAttachments = (atts: any[]) => {
        if (!includeImages || !Array.isArray(atts) || atts.length === 0) return [];
        return atts.filter(att => {
            if (!isGenuineDiscordAttachment(att, ignoreWebPreviews)) return false;
            if (onlyImages && !isImageAttachment(att)) return false;
            return true;
        });
    };

    if (format === "json") {
        return JSON.stringify(
            {
                meta: {
                    exporter: "DMChatExporter (Kettu Mobile)",
                    exportedAt,
                    channelId: channel.id,
                    channelName,
                    channelType:
                        channel.type === CHANNEL_TYPE_DM
                            ? "DM"
                            : channel.type === CHANNEL_TYPE_GROUP_DM
                            ? "GROUP_DM"
                            : "CHANNEL",
                    totalMessages: messages.length,
                    includeImages,
                    onlyImages,
                    webPreviewsIgnored: ignoreWebPreviews,
                },
                messages: messages.map((m: any) => ({
                    id: m.id,
                    timestamp: m.timestamp,
                    dateFormatted: formatDateReadable(m.timestamp),
                    pinned: Boolean(m.pinned),
                    author: {
                        id: m.author?.id,
                        username: m.author?.username,
                        displayName: m.author?.global_name || m.author?.username,
                    },
                    content: m.content || "",
                    replyToMessageId: m.message_reference?.message_id || null,
                    attachments: filterAttachments(m.attachments).map((a: any) => ({
                        id: a.id,
                        filename: a.filename,
                        size: a.size,
                        isImage: isImageAttachment(a),
                        url: a.url,
                    })),
                })),
            },
            null,
            2
        );
    }

    if (format === "md") {
        const lines = [
            `# 💬 Historial de MD: ${channelName}`,
            `- **ID del Canal:** \`${channel.id}\``,
            `- **Fecha:** ${formatDateReadable(exportedAt)}`,
            `- **Total de mensajes:** ${messages.length}`,
            `- **Previsualizaciones de sitios web:** Ignoradas (solo adjuntos reales)`,
            "",
            "---",
            "",
        ];
        for (const m of messages) {
            const author = m.author?.global_name || m.author?.username || "Usuario";
            const time = formatDateReadable(m.timestamp);
            const pin = m.pinned ? " 📌 **PIN**" : "";
            lines.push(`### **${author}** — *${time}*${pin}`);
            if (m.content) lines.push(m.content);
            for (const att of filterAttachments(m.attachments)) {
                if (isImageAttachment(att)) {
                    lines.push(`![${att.filename}](${att.url})`);
                } else {
                    lines.push(`- 📎 [${att.filename}](${att.url})`);
                }
            }
            lines.push("");
        }
        return lines.join("\n");
    }

    const lines = [
        "======================================================================",
        ` HISTORIAL DE CHAT MD: ${channelName}`,
        ` ID del Canal        : ${channel.id}`,
        ` Exportado el        : ${formatDateReadable(exportedAt)}`,
        ` Total de Mensajes   : ${messages.length}`,
        ` Imágenes Adjuntas   : ${includeImages ? "Incluidas (Solo adjuntos reales subidos al MD, sin previews web)" : "Omitidas (Solo texto)"}`,
        "======================================================================",
        "",
    ];

    for (const m of messages) {
        const author = m.author?.global_name || m.author?.username || "Usuario";
        const time = formatDateReadable(m.timestamp);
        const pin = m.pinned ? " [📌 PIN]" : "";
        const edit = m.edited_timestamp ? " (editado)" : "";
        lines.push(`[${time}]${pin} ${author}${edit}: ${m.content || ""}`);
        for (const att of filterAttachments(m.attachments)) {
            const label = isImageAttachment(att) ? "🖼 Imagen adjunta" : "📎 Archivo adjunto";
            lines.push(`    └── ${label}: ${att.filename} -> ${att.url}`);
        }
    }

    return lines.join("\n");
}

let isExportRunning = false;

export async function runDMExport(options?: {
    channelId?: string;
    format?: "txt" | "json" | "md";
    includeImages?: boolean;
    rangeMode?: "all" | "to_last_pin" | "only_pins";
    maxLimit?: number;
    onStatus?: (msg: string) => void;
}) {
    if (isExportRunning) {
        showToast("⏳ Ya hay una exportación de MD en curso.");
        return;
    }

    const { ChannelStore, SelectedChannelStore, UserStore, RestAPI, Clipboard } = getStores();
    const targetChannelId = options?.channelId || SelectedChannelStore?.getChannelId?.();

    if (!targetChannelId) {
        showToast("❌ Abre primero el chat de MD que deseas exportar.");
        return;
    }

    const channel = ChannelStore?.getChannel?.(targetChannelId);
    if (!channel) {
        showToast("❌ No se pudo encontrar la información del canal actual.");
        return;
    }

    const isDM = channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM;
    if (!isDM && !storage.allowServers) {
        showToast("⚠️ Este plugin está configurado solo para Mensajes Directos (MD).");
        return;
    }

    const format = options?.format ?? storage.format ?? "txt";
    const includeImages = options?.includeImages ?? storage.includeImages ?? true;
    const onlyImages = storage.onlyImages ?? true;
    const ignoreWebPreviews = storage.ignoreWebPreviews ?? true;
    const rangeMode = options?.rangeMode ?? storage.rangeMode ?? "all";
    const maxLimit = options?.maxLimit ?? 0;
    const delayMs = Number(storage.batchDelayMs) || 450;
    const channelName = getChannelDisplayName(channel, UserStore);

    isExportRunning = true;
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    try {
        showToast(`📥 Iniciando exportación de MD: ${channelName}...`);
        options?.onStatus?.(`Iniciando lectura de ${channelName}...`);

        let allMessages: any[] = [];

        if (rangeMode === "only_pins") {
            const pinRes = await RestAPI.get({ url: `/channels/${targetChannelId}/pins` });
            allMessages = Array.isArray(pinRes?.body) ? pinRes.body : [];
            allMessages.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        } else {
            let stopAtPinId: bigint | null = null;
            if (rangeMode === "to_last_pin") {
                try {
                    const pinRes = await RestAPI.get({ url: `/channels/${targetChannelId}/pins` });
                    const pins = Array.isArray(pinRes?.body) ? pinRes.body : [];
                    if (pins.length > 0) {
                        stopAtPinId = BigInt(pins[0].id);
                        for (const p of pins) {
                            const pid = BigInt(p.id);
                            if (pid > stopAtPinId) stopAtPinId = pid;
                        }
                    }
                } catch {}
            }

            let afterCursor = "0";
            let batchCount = 0;

            while (true) {
                try {
                    const res = await RestAPI.get({
                        url: `/channels/${targetChannelId}/messages`,
                        query: { limit: 100, after: afterCursor },
                    });

                    const batch: any[] = Array.isArray(res?.body) ? res.body : [];
                    if (batch.length === 0) break;

                    batch.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

                    let stopReached = false;
                    for (const msg of batch) {
                        if (stopAtPinId !== null && BigInt(msg.id) > stopAtPinId) {
                            stopReached = true;
                            break;
                        }
                        // Limpiar embeds de sitios web para no procesarlos nunca
                        msg.embeds = [];
                        allMessages.push(msg);
                        if (maxLimit > 0 && allMessages.length >= maxLimit) {
                            stopReached = true;
                            break;
                        }
                    }

                    batchCount++;
                    afterCursor = batch[batch.length - 1].id;

                    if (batchCount % 3 === 0) {
                        const statusText = `⏳ ${allMessages.length} mensajes leídos en ${channelName}...`;
                        showToast(statusText);
                        options?.onStatus?.(statusText);
                    }

                    if (stopReached || batch.length < 100) break;
                    await sleep(delayMs);
                } catch (err: any) {
                    const retryAfter = err?.body?.retry_after || err?.retry_after;
                    if (retryAfter) {
                        const waitMs = Math.ceil(Number(retryAfter) * 1000) + 300;
                        options?.onStatus?.(`Rate limit: esperando ${(waitMs / 1000).toFixed(1)}s...`);
                        await sleep(waitMs);
                        continue;
                    }
                    throw err;
                }
            }
        }

        if (allMessages.length === 0) {
            showToast("⚠️ No se encontraron mensajes para exportar.");
            options?.onStatus?.("No se encontraron mensajes.");
            return;
        }

        const outputText = formatMessagesForExport(
            allMessages,
            channel,
            channelName,
            format,
            includeImages,
            onlyImages,
            ignoreWebPreviews
        );

        const summary = `✅ Exportados ${allMessages.length} mensajes de "${channelName}" en .${format.toUpperCase()} (${new Date().toLocaleTimeString()})`;
        storage.lastExportSummary = summary;
        options?.onStatus?.(summary);

        try {
            Clipboard?.setString?.(outputText);
        } catch {}

        const ShareModule = General?.Share || ReactNative?.Share;
        if (ShareModule && typeof ShareModule.share === "function") {
            const safeName = channelName.replace(/[^a-zA-Z0-9_-]/g, "_");
            await ShareModule.share({
                title: `MD_${safeName}.${format}`,
                message: outputText,
            });
        }

        showToast(`✅ ¡Listo! ${allMessages.length} mensajes exportados (y copiados al portapapeles).`);
    } catch (e: any) {
        const msg = e?.message || String(e);
        logger?.error?.("DMChatExporter error:", e);
        showToast(`❌ Error al exportar: ${msg}`);
        options?.onStatus?.(`Error: ${msg}`);
    } finally {
        isExportRunning = false;
    }
}

function SettingsPanel() {
    const [format, setFormat] = React.useState(storage.format || "txt");
    const [includeImages, setIncludeImages] = React.useState(storage.includeImages ?? true);
    const [onlyImages, setOnlyImages] = React.useState(storage.onlyImages ?? true);
    const [ignoreWebPreviews, setIgnoreWebPreviews] = React.useState(storage.ignoreWebPreviews ?? true);
    const [rangeMode, setRangeMode] = React.useState(storage.rangeMode || "all");
    const [allowServers, setAllowServers] = React.useState(storage.allowServers ?? false);
    const [statusMsg, setStatusMsg] = React.useState(storage.lastExportSummary || "Listo para exportar.");

    const cycleFormat = () => {
        const next = format === "txt" ? "json" : format === "json" ? "md" : "txt";
        storage.format = next;
        setFormat(next);
    };

    const cycleRange = () => {
        const next = rangeMode === "all" ? "to_last_pin" : rangeMode === "to_last_pin" ? "only_pins" : "all";
        storage.rangeMode = next;
        setRangeMode(next);
    };

    const rangeLabel =
        rangeMode === "all"
            ? "De principio a fin (Todo el chat)"
            : rangeMode === "to_last_pin"
            ? "De principio hasta el último Pin"
            : "Solo mensajes fijados (Pins)";

    return React.createElement(
        ScrollView,
        { style: { flex: 1, padding: 12 } },
        React.createElement(
            FormSection,
            { title: "Configuración de Exportación de MD" },
            React.createElement(FormRow, {
                label: `Formato de salida: .${format.toUpperCase()}`,
                subLabel: "Toca para cambiar entre TXT (legible), JSON (estructurado) y MD (Markdown)",
                onPress: cycleFormat,
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Incluir imágenes / archivos subidos al MD",
                subLabel: "Si se desactiva, se descargará únicamente el texto de los mensajes",
                value: includeImages,
                onValueChange: (v: boolean) => {
                    storage.includeImages = v;
                    setIncludeImages(v);
                },
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Ignorar previsualizaciones de sitios web (Links/Embeds)",
                subLabel: "Evita incluir imágenes/vídeos de links externos (YouTube, Twitter, Tenor, webs); solo procesa archivos subidos al chat",
                value: ignoreWebPreviews,
                onValueChange: (v: boolean) => {
                    storage.ignoreWebPreviews = v;
                    setIgnoreWebPreviews(v);
                },
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Filtrar solo imágenes adjuntas",
                subLabel: "Incluye solo fotos/GIFs subidos (PNG, JPG, GIF, WEBP) e ignora otros archivos",
                value: onlyImages,
                onValueChange: (v: boolean) => {
                    storage.onlyImages = v;
                    setOnlyImages(v);
                },
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormRow, {
                label: `Recorrido: ${rangeLabel}`,
                subLabel: "Toca para alternar entre Todo el chat, Principio a Pin, o Solo Pins",
                onPress: cycleRange,
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Permitir también en canales de servidor",
                subLabel: "Por defecto está restringido exclusivamente a Mensajes Directos (MD)",
                value: allowServers,
                onValueChange: (v: boolean) => {
                    storage.allowServers = v;
                    setAllowServers(v);
                },
            })
        ),
        React.createElement(
            FormSection,
            { title: "Exportar el MD Abierto Actualmente" },
            React.createElement(FormRow, {
                label: "📥 Descargar el MD actual ahora",
                subLabel: statusMsg,
                onPress: () => runDMExport({ onStatus: setStatusMsg }),
            })
        )
    );
}

let unregisterCommand: (() => void) | null = null;

export const onLoad = () => {
    try {
        unregisterCommand = registerCommand({
            name: "exportdm",
            displayName: "exportdm",
            description: "Descarga todo el historial del MD actual de principio a fin (con o sin imágenes subidas)",
            displayDescription: "Descarga todo el historial del MD actual de principio a fin (con o sin imágenes subidas)",
            options: [
                {
                    name: "formato",
                    displayName: "formato",
                    description: "Formato: txt, json o md",
                    displayDescription: "Formato: txt, json o md",
                    type: 3,
                    required: false,
                },
                {
                    name: "imagenes",
                    displayName: "imagenes",
                    description: "Incluir imágenes subidas al MD (true / false)",
                    displayDescription: "Incluir imágenes subidas al MD (true / false)",
                    type: 5,
                    required: false,
                },
                {
                    name: "modo",
                    displayName: "modo",
                    description: "all (todo), to_last_pin (principio a pin), only_pins (solo pins)",
                    displayDescription: "all (todo), to_last_pin (principio a pin), only_pins (solo pins)",
                    type: 3,
                    required: false,
                },
            ],
            applicationId: "-1",
            inputType: 1,
            type: 1,
            execute: (args: any[], ctx: any) => {
                const fmtArg = args?.find((a: any) => a.name === "formato")?.value;
                const imgArg = args?.find((a: any) => a.name === "imagenes")?.value;
                const modeArg = args?.find((a: any) => a.name === "modo")?.value;

                const validFormat =
                    fmtArg === "json" || fmtArg === "txt" || fmtArg === "md" ? fmtArg : undefined;
                const validMode =
                    modeArg === "all" || modeArg === "to_last_pin" || modeArg === "only_pins"
                        ? modeArg
                        : undefined;

                runDMExport({
                    channelId: ctx?.channel?.id,
                    format: validFormat,
                    includeImages: typeof imgArg === "boolean" ? imgArg : undefined,
                    rangeMode: validMode,
                });

                return {
                    content: "⏳ **DMChatExporter:** Descargando historial del MD en segundo plano (ignorando previsualizaciones de links web)... Al terminar se abrirá el menú para guardar/compartir el archivo.",
                };
            },
        });
    } catch (e) {
        logger?.error?.("No se pudo registrar el comando /exportdm en Kettu:", e);
    }
};

export const onUnload = () => {
    try {
        unregisterCommand?.();
    } catch {}
};

export const settings = SettingsPanel;
