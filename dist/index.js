(function (vendetta) {
"use strict";

const { metro, commands, plugin, ui, logger } = vendetta;
const { findByProps, findByStoreName } = metro;
const { React, ReactNative } = metro.common;
const { registerCommand } = commands;
const { storage } = plugin;
// const { showToast } = ui.toasts;
const { Forms, General } = ui.components;

const { ScrollView } = General;
const { FormSection, FormRow, FormSwitchRow, FormDivider } = Forms;

storage.format ??= "txt";
storage.includeImages ??= true;
storage.onlyImages ??= true;
storage.ignoreWebPreviews ??= true;
storage.rangeMode ??= "all";
storage.batchDelayMs ??= 450;
storage.allowServers ??= false;
storage.lastExportSummary ??= "Ninguna exportación realizada aún.";

const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GROUP_DM = 3;
const ALLOWED_DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function isGenuineDiscordAttachment(att, strictCdn) {
    if (strictCdn === undefined) strictCdn = true;
    if (!att || typeof att.url !== "string" || !att.id || !att.filename) return false;
    if (!strictCdn) return true;
    try {
        const parsed = new URL(att.url);
        if (parsed.protocol !== "https:") return false;
        if (!ALLOWED_DISCORD_CDN_HOSTS.has(parsed.hostname.toLowerCase())) return false;
        if (!parsed.pathname.startsWith("/attachments/")) return false;
        return true;
    } catch (e) {
        return false;
    }
}

function isImageAttachment(att) {
    if (att && att.content_type) {
        return String(att.content_type).toLowerCase().startsWith("image/");
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif)(\?|$)/i.test((att && (att.filename || att.url)) || "");
}

function getStores() {
    const ChannelStore = findByStoreName("ChannelStore") || findByProps("getChannel", "getDMFromUserId");
    const SelectedChannelStore = findByStoreName("SelectedChannelStore") || findByProps("getChannelId", "getVoiceChannelId");
    const UserStore = findByStoreName("UserStore") || findByProps("getCurrentUser", "getUser");
    const RestAPI = findByProps("get", "post", "put", "del", "patch") || (metro.common && metro.common.RestAPI);
    const Clipboard = findByProps("setString", "getString") || (ReactNative && ReactNative.Clipboard);
    return { ChannelStore, SelectedChannelStore, UserStore, RestAPI, Clipboard };
}

function formatDateReadable(iso) {
    try {
        const d = new Date(iso);
        const pad = function (n) { return String(n).padStart(2, "0"); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    } catch (e) {
        return iso;
    }
}

function getChannelDisplayName(channel, UserStore) {
    if (!channel) return "MD_Desconocido";
    if (channel.type === CHANNEL_TYPE_DM) {
        const recipientId = channel.recipients && channel.recipients[0];
        const u = recipientId && UserStore && UserStore.getUser ? UserStore.getUser(recipientId) : null;
        return (u && (u.globalName || u.username)) || channel.name || ("MD_" + channel.id);
    }
    if (channel.type === CHANNEL_TYPE_GROUP_DM) {
        if (channel.name) return channel.name;
        const names = (channel.recipients || []).map(function (id) {
            const u = UserStore && UserStore.getUser ? UserStore.getUser(id) : null;
            return (u && (u.globalName || u.username)) || id;
        }).join(", ");
        return names ? ("Grupo_" + names) : ("Grupo_" + channel.id);
    }
    return channel.name || ("Canal_" + channel.id);
}

function formatMessagesForExport(messages, channel, channelName, format, includeImages, onlyImages, ignoreWebPreviews) {
    if (ignoreWebPreviews === undefined) ignoreWebPreviews = true;
    const exportedAt = new Date().toISOString();

    const filterAttachments = function (atts) {
        if (!includeImages || !Array.isArray(atts) || atts.length === 0) return [];
        return atts.filter(function (att) {
            if (!isGenuineDiscordAttachment(att, ignoreWebPreviews)) return false;
            if (onlyImages && !isImageAttachment(att)) return false;
            return true;
        });
    };

    if (format === "json") {
        return JSON.stringify({
            meta: {
                exporter: "DMChatExporter (Kettu Mobile)",
                exportedAt: exportedAt,
                channelId: channel.id,
                channelName: channelName,
                channelType: channel.type === CHANNEL_TYPE_DM ? "DM" : channel.type === CHANNEL_TYPE_GROUP_DM ? "GROUP_DM" : "CHANNEL",
                totalMessages: messages.length,
                includeImages: includeImages,
                onlyImages: onlyImages,
                webPreviewsIgnored: ignoreWebPreviews
            },
            messages: messages.map(function (m) {
                return {
                    id: m.id,
                    timestamp: m.timestamp,
                    dateFormatted: formatDateReadable(m.timestamp),
                    pinned: Boolean(m.pinned),
                    author: {
                        id: m.author && m.author.id,
                        username: m.author && m.author.username,
                        displayName: (m.author && (m.author.global_name || m.author.username)) || "Usuario"
                    },
                    content: m.content || "",
                    replyToMessageId: (m.message_reference && m.message_reference.message_id) || null,
                    attachments: filterAttachments(m.attachments).map(function (a) {
                        return {
                            id: a.id,
                            filename: a.filename,
                            size: a.size,
                            isImage: isImageAttachment(a),
                            url: a.url
                        };
                    })
                };
            })
        }, null, 2);
    }

    if (format === "md") {
        const lines = [
            "# 💬 Historial de MD: " + channelName,
            "- **ID del Canal:** `" + channel.id + "`",
            "- **Fecha:** " + formatDateReadable(exportedAt),
            "- **Total de mensajes:** " + messages.length,
            "- **Previsualizaciones de sitios web:** Ignoradas (solo adjuntos reales)",
            "",
            "---",
            ""
        ];
        for (const m of messages) {
            const author = (m.author && (m.author.global_name || m.author.username)) || "Usuario";
            const time = formatDateReadable(m.timestamp);
            const pin = m.pinned ? " 📌 **PIN**" : "";
            lines.push("### **" + author + "** — *" + time + "*" + pin);
            if (m.content) lines.push(m.content);
            for (const att of filterAttachments(m.attachments)) {
                if (isImageAttachment(att)) {
                    lines.push("![" + att.filename + "](" + att.url + ")");
                } else {
                    lines.push("- 📎 [" + att.filename + "](" + att.url + ")");
                }
            }
            lines.push("");
        }
        return lines.join("\n");
    }

    const lines = [
        "======================================================================",
        " HISTORIAL DE CHAT MD: " + channelName,
        " ID del Canal        : " + channel.id,
        " Exportado el        : " + formatDateReadable(exportedAt),
        " Total de Mensajes   : " + messages.length,
        " Imágenes Adjuntas   : " + (includeImages ? "Incluidas (Solo adjuntos reales subidos al MD, sin previews web)" : "Omitidas (Solo texto)"),
        "======================================================================",
        ""
    ];

    for (const m of messages) {
        const author = (m.author && (m.author.global_name || m.author.username)) || "Usuario";
        const time = formatDateReadable(m.timestamp);
        const pin = m.pinned ? " [📌 PIN]" : "";
        const edit = m.edited_timestamp ? " (editado)" : "";
        lines.push("[" + time + "]" + pin + " " + author + edit + ": " + (m.content || ""));
        for (const att of filterAttachments(m.attachments)) {
            const label = isImageAttachment(att) ? "🖼 Imagen adjunta" : "📎 Archivo adjunto";
            lines.push("    └── " + label + ": " + att.filename + " -> " + att.url);
        }
    }

    return lines.join("\n");
}

let isExportRunning = false;

async function runDMExport(options) {
    options = options || {};
    if (isExportRunning) {
        // showToast("⏳ Ya hay una exportación de MD en curso.");
        return;
    }

    const stores = getStores();
    const ChannelStore = stores.ChannelStore;
    const SelectedChannelStore = stores.SelectedChannelStore;
    const UserStore = stores.UserStore;
    const RestAPI = stores.RestAPI;
    const Clipboard = stores.Clipboard;

    const targetChannelId = options.channelId || (SelectedChannelStore && SelectedChannelStore.getChannelId && SelectedChannelStore.getChannelId());
    if (!targetChannelId) {
        // showToast("❌ Abre primero el chat de MD que deseas exportar.");
        return;
    }

    const channel = ChannelStore && ChannelStore.getChannel ? ChannelStore.getChannel(targetChannelId) : null;
    if (!channel) {
        // showToast("❌ No se pudo encontrar la información del canal actual.");
        return;
    }

    const isDM = channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM;
    if (!isDM && !storage.allowServers) {
        // showToast("⚠️ Este plugin está configurado solo para Mensajes Directos (MD).");
        return;
    }

    const format = options.format || storage.format || "txt";
    const includeImages = typeof options.includeImages === "boolean" ? options.includeImages : (storage.includeImages ?? true);
    const onlyImages = storage.onlyImages ?? true;
    const ignoreWebPreviews = storage.ignoreWebPreviews ?? true;
    const rangeMode = options.rangeMode || storage.rangeMode || "all";
    const maxLimit = options.maxLimit || 0;
    const delayMs = Number(storage.batchDelayMs) || 450;
    const channelName = getChannelDisplayName(channel, UserStore);

    isExportRunning = true;
    const sleep = function (ms) { return new Promise(function (res) { setTimeout(res, ms); }); };

    try {
        // showToast("📥 Iniciando exportación de MD: " + channelName + "...");
        if (options.onStatus) options.onStatus("Iniciando lectura de " + channelName + "...");

        let allMessages = [];

        if (rangeMode === "only_pins") {
            const pinRes = await RestAPI.get({ url: "/channels/" + targetChannelId + "/pins" });
            allMessages = Array.isArray(pinRes && pinRes.body) ? pinRes.body : [];
            allMessages.sort(function (a, b) { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; });
        } else {
            let stopAtPinId = null;
            if (rangeMode === "to_last_pin") {
                try {
                    const pinRes = await RestAPI.get({ url: "/channels/" + targetChannelId + "/pins" });
                    const pins = Array.isArray(pinRes && pinRes.body) ? pinRes.body : [];
                    if (pins.length > 0) {
                        stopAtPinId = BigInt(pins[0].id);
                        for (const p of pins) {
                            const pid = BigInt(p.id);
                            if (pid > stopAtPinId) stopAtPinId = pid;
                        }
                    }
                } catch (e) {}
            }

            let afterCursor = "0";
            let batchCount = 0;

            while (true) {
                try {
                    const res = await RestAPI.get({
                        url: "/channels/" + targetChannelId + "/messages",
                        query: { limit: 100, after: afterCursor }
                    });

                    const batch = Array.isArray(res && res.body) ? res.body : [];
                    if (batch.length === 0) break;

                    batch.sort(function (a, b) { return BigInt(a.id) < BigInt(b.id) ? -1 : 1; });

                    let stopReached = false;
                    for (const msg of batch) {
                        if (stopAtPinId !== null && BigInt(msg.id) > stopAtPinId) {
                            stopReached = true;
                            break;
                        }
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
                        const statusText = "⏳ " + allMessages.length + " mensajes leídos en " + channelName + "...";
                        // showToast(statusText);
                        if (options.onStatus) options.onStatus(statusText);
                    }

                    if (stopReached || batch.length < 100) break;
                    await sleep(delayMs);
                } catch (err) {
                    const retryAfter = (err && err.body && err.body.retry_after) || (err && err.retry_after);
                    if (retryAfter) {
                        const waitMs = Math.ceil(Number(retryAfter) * 1000) + 300;
                        if (options.onStatus) options.onStatus("Rate limit: esperando " + (waitMs / 1000).toFixed(1) + "s...");
                        await sleep(waitMs);
                        continue;
                    }
                    throw err;
                }
            }
        }

        if (allMessages.length === 0) {
            // showToast("⚠️ No se encontraron mensajes para exportar.");
            if (options.onStatus) options.onStatus("No se encontraron mensajes.");
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

        const summary = "✅ Exportados " + allMessages.length + " mensajes de \"" + channelName + "\" en ." + format.toUpperCase();
        storage.lastExportSummary = summary;
        if (options.onStatus) options.onStatus(summary);

        try {
            if (Clipboard && Clipboard.setString) Clipboard.setString(outputText);
        } catch (e) {}

        const ShareModule = (General && General.Share) || (ReactNative && ReactNative.Share);
        if (ShareModule && typeof ShareModule.share === "function") {
            const safeName = channelName.replace(/[^a-zA-Z0-9_-]/g, "_");
            await ShareModule.share({
                title: "MD_" + safeName + "." + format,
                message: outputText
            });
        }

        // showToast("✅ ¡Listo! " + allMessages.length + " mensajes exportados (y copiados al portapapeles).");
    } catch (e) {
        const msg = (e && e.message) || String(e);
        if (logger && logger.error) logger.error("DMChatExporter error:", e);
        // showToast("❌ Error al exportar: " + msg);
        if (options.onStatus) options.onStatus("Error: " + msg);
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

    const cycleFormat = function () {
        const next = format === "txt" ? "json" : format === "json" ? "md" : "txt";
        storage.format = next;
        setFormat(next);
    };

    const cycleRange = function () {
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
                label: "Formato de salida: ." + format.toUpperCase(),
                subLabel: "Toca para cambiar entre TXT (legible), JSON (estructurado) y MD (Markdown)",
                onPress: cycleFormat
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Incluir imágenes / archivos subidos al MD",
                subLabel: "Si se desactiva, se descargará únicamente el texto de los mensajes",
                value: includeImages,
                onValueChange: function (v) {
                    storage.includeImages = v;
                    setIncludeImages(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Ignorar previsualizaciones de sitios web (Links/Embeds)",
                subLabel: "Evita incluir imágenes/vídeos de links externos; solo procesa archivos realmente subidos al MD",
                value: ignoreWebPreviews,
                onValueChange: function (v) {
                    storage.ignoreWebPreviews = v;
                    setIgnoreWebPreviews(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Filtrar solo imágenes adjuntas",
                subLabel: "Incluye solo fotos/GIFs subidos (PNG, JPG, GIF, WEBP) e ignora otros archivos",
                value: onlyImages,
                onValueChange: function (v) {
                    storage.onlyImages = v;
                    setOnlyImages(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormRow, {
                label: "Recorrido: " + rangeLabel,
                subLabel: "Toca para alternar entre Todo el chat, Principio a Pin, o Solo Pins",
                onPress: cycleRange
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Permitir también en canales de servidor",
                subLabel: "Por defecto está restringido exclusivamente a Mensajes Directos (MD)",
                value: allowServers,
                onValueChange: function (v) {
                    storage.allowServers = v;
                    setAllowServers(v);
                }
            })
        ),
        React.createElement(
            FormSection,
            { title: "Exportar el MD Abierto Actualmente" },
            React.createElement(FormRow, {
                label: "📥 Descargar el MD actual ahora",
                subLabel: statusMsg,
                onPress: function () { runDMExport({ onStatus: setStatusMsg }); }
            })
        )
    );
}

let unregisterCommand = null;

return {
    onLoad: function () {
        try {
            unregisterCommand = registerCommand({
                name: "exportdm",
                displayName: "exportdm",
                description: "Descarga todo el historial del MD actual de principio a fin",
                displayDescription: "Descarga todo el historial del MD actual de principio a fin",
                options: [
                    {
                        name: "formato",
                        displayName: "formato",
                        description: "Formato: txt, json o md",
                        displayDescription: "Formato: txt, json o md",
                        type: 3,
                        required: false
                    },
                    {
                        name: "imagenes",
                        displayName: "imagenes",
                        description: "Incluir imágenes subidas al MD (true / false)",
                        displayDescription: "Incluir imágenes subidas al MD (true / false)",
                        type: 5,
                        required: false
                    },
                    {
                        name: "modo",
                        displayName: "modo",
                        description: "all (todo), to_last_pin (principio a pin), only_pins (solo pins)",
                        displayDescription: "all (todo), to_last_pin (principio a pin), only_pins (solo pins)",
                        type: 3,
                        required: false
                    }
                ],
                applicationId: "-1",
                inputType: 1,
                type: 1,
                execute: function (args, ctx) {
                    const fmtArg = args && args.find(function(a) { return a.name === "formato"; });
                    const imgArg = args && args.find(function(a) { return a.name === "imagenes"; });
                    const modeArg = args && args.find(function(a) { return a.name === "modo"; });

                    const validFormat = (fmtArg && (fmtArg.value === "json" || fmtArg.value === "txt" || fmtArg.value === "md")) ? fmtArg.value : undefined;
                    const validMode = (modeArg && (modeArg.value === "all" || modeArg.value === "to_last_pin" || modeArg.value === "only_pins")) ? modeArg.value : undefined;

                    runDMExport({
                        channelId: ctx && ctx.channel && ctx.channel.id,
                        format: validFormat,
                        includeImages: imgArg ? Boolean(imgArg.value) : undefined,
                        rangeMode: validMode
                    });

                    return {
                        content: "⏳ **DMChatExporter:** Descargando historial del MD en segundo plano..."
                    };
                }
            });
        } catch (e) {
            if (logger && logger.error) logger.error("No se pudo registrar el comando /exportdm:", e);
        }
    },
    onUnload: function () {
        try {
            if (unregisterCommand) unregisterCommand();
        } catch (e) {}
    },
    settings: SettingsPanel
};
})(window.vendetta);
