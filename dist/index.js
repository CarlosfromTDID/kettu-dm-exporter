(function (vendetta) {
"use strict";

const { metro, commands, plugin, ui, logger } = vendetta;
const { findByProps, findByStoreName } = metro;
const { React, ReactNative } = metro.common;
const { registerCommand } = commands;
const { storage } = plugin;
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
storage.lastExportSummary ??= "No export performed yet.";

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
    if (!channel) return "Unknown_DM";
    if (channel.type === CHANNEL_TYPE_DM) {
        const recipientId = channel.recipients && channel.recipients[0];
        const u = recipientId && UserStore && UserStore.getUser ? UserStore.getUser(recipientId) : null;
        return (u && (u.globalName || u.username)) || channel.name || ("DM_" + channel.id);
    }
    if (channel.type === CHANNEL_TYPE_GROUP_DM) {
        if (channel.name) return channel.name;
        const names = (channel.recipients || []).map(function (id) {
            const u = UserStore && UserStore.getUser ? UserStore.getUser(id) : null;
            return (u && (u.globalName || u.username)) || id;
        }).join(", ");
        return names ? ("Group_" + names) : ("Group_" + channel.id);
    }
    return channel.name || ("Channel_" + channel.id);
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
                        displayName: (m.author && (m.author.global_name || m.author.username)) || "User"
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
            "# 💬 DM History: " + channelName,
            "- **Channel ID:** `" + channel.id + "`",
            "- **Date:** " + formatDateReadable(exportedAt),
            "- **Total messages:** " + messages.length,
            "- **Web Previews:** Ignored (Only real attachments)",
            "",
            "---",
            ""
        ];
        for (const m of messages) {
            const author = (m.author && (m.author.global_name || m.author.username)) || "User";
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
        " DM CHAT HISTORY: " + channelName,
        " Channel ID      : " + channel.id,
        " Exported At     : " + formatDateReadable(exportedAt),
        " Total Messages  : " + messages.length,
        " Attachments     : " + (includeImages ? "Included (Only real uploads, no web previews)" : "Omitted (Text only)"),
        "======================================================================",
        ""
    ];

    for (const m of messages) {
        const author = (m.author && (m.author.global_name || m.author.username)) || "User";
        const time = formatDateReadable(m.timestamp);
        const pin = m.pinned ? " [📌 PIN]" : "";
        const edit = m.edited_timestamp ? " (edited)" : "";
        lines.push("[" + time + "]" + pin + " " + author + edit + ": " + (m.content || ""));
        for (const att of filterAttachments(m.attachments)) {
            const label = isImageAttachment(att) ? "🖼 Image attached" : "📎 File attached";
            lines.push("    └── " + label + ": " + att.filename + " -> " + att.url);
        }
    }

    return lines.join("\n");
}

let isExportRunning = false;

async function runDMExport(options) {
    options = options || {};
    if (isExportRunning) return;

    const stores = getStores();
    const ChannelStore = stores.ChannelStore;
    const SelectedChannelStore = stores.SelectedChannelStore;
    const UserStore = stores.UserStore;
    const RestAPI = stores.RestAPI;
    const Clipboard = stores.Clipboard;

    const targetChannelId = options.channelId || (SelectedChannelStore && SelectedChannelStore.getChannelId && SelectedChannelStore.getChannelId());
    if (!targetChannelId) return;

    const channel = ChannelStore && ChannelStore.getChannel ? ChannelStore.getChannel(targetChannelId) : null;
    if (!channel) return;

    const isDM = channel.type === CHANNEL_TYPE_DM || channel.type === CHANNEL_TYPE_GROUP_DM;
    if (!isDM && !storage.allowServers) return;

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
        if (options.onStatus) options.onStatus("Starting to read " + channelName + "...");

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
                        const statusText = "⏳ " + allMessages.length + " messages read in " + channelName + "...";
                        if (options.onStatus) options.onStatus(statusText);
                    }

                    if (stopReached || batch.length < 100) break;
                    await sleep(delayMs);
                } catch (err) {
                    const retryAfter = (err && err.body && err.body.retry_after) || (err && err.retry_after);
                    if (retryAfter) {
                        const waitMs = Math.ceil(Number(retryAfter) * 1000) + 300;
                        if (options.onStatus) options.onStatus("Rate limit: waiting " + (waitMs / 1000).toFixed(1) + "s...");
                        await sleep(waitMs);
                        continue;
                    }
                    throw err;
                }
            }
        }

        if (allMessages.length === 0) {
            if (options.onStatus) options.onStatus("No messages found.");
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

        const summary = "✅ Exported " + allMessages.length + " messages from \"" + channelName + "\" to ." + format.toUpperCase();
        storage.lastExportSummary = summary;
        if (options.onStatus) options.onStatus(summary);

        try {
            if (Clipboard && Clipboard.setString) Clipboard.setString(outputText);
        } catch (e) {}

        const ShareModule = (General && General.Share) || (ReactNative && ReactNative.Share);
        const FileManager = ReactNative.NativeModules.DCDFileManager || ReactNative.NativeModules.RTNFileManager;
        
        const safeName = channelName.replace(/[^a-zA-Z0-9_-]/g, "_");
        const fileName = "MD_" + safeName + "." + format;
        let fileShared = false;

        if (FileManager && typeof FileManager.writeFile === "function") {
            try {
                const cacheDir = (FileManager.getConstants && FileManager.getConstants().CacheDirPath) || "/data/user/0/com.discord/cache";
                const filePath = cacheDir + "/" + fileName;
                
                await FileManager.writeFile(filePath, outputText, "utf8");
                
                if (ShareModule && typeof ShareModule.share === "function") {
                    await ShareModule.share({ url: "file://" + filePath, title: fileName });
                    fileShared = true;
                }
            } catch (err1) {
                try {
                    await FileManager.writeFile('cache', fileName, outputText, 'utf8');
                    const cacheDir = (FileManager.getConstants && FileManager.getConstants().CacheDirPath) || "/data/user/0/com.discord/cache";
                    if (ShareModule && typeof ShareModule.share === "function") {
                        await ShareModule.share({ url: "file://" + cacheDir + "/" + fileName, title: fileName });
                        fileShared = true;
                    }
                } catch (err2) {
                    if (logger && logger.error) logger.error("File write error:", err2);
                }
            }
        }

        if (!fileShared && ShareModule && typeof ShareModule.share === "function") {
            await ShareModule.share({
                title: fileName,
                message: outputText
            });
        }

    } catch (e) {
        const msg = (e && e.message) || String(e);
        if (logger && logger.error) logger.error("DMChatExporter error:", e);
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
    const [statusMsg, setStatusMsg] = React.useState(storage.lastExportSummary || "Ready to export.");

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
            ? "Start to finish (Entire chat)"
            : rangeMode === "to_last_pin"
            ? "Start to last Pin"
            : "Only pinned messages (Pins)";

    return React.createElement(
        ScrollView,
        { style: { flex: 1, padding: 12 } },
        React.createElement(
            FormSection,
            { title: "DM Export Configuration" },
            React.createElement(FormRow, {
                label: "Output format: ." + format.toUpperCase(),
                subLabel: "Tap to toggle between TXT (readable), JSON (structured) and MD (Markdown)",
                onPress: cycleFormat
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Include images / uploaded files",
                subLabel: "If disabled, only message text will be downloaded",
                value: includeImages,
                onValueChange: function (v) {
                    storage.includeImages = v;
                    setIncludeImages(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Ignore website previews (Links/Embeds)",
                subLabel: "Prevents including external link media; only processes actual uploaded files",
                value: ignoreWebPreviews,
                onValueChange: function (v) {
                    storage.ignoreWebPreviews = v;
                    setIgnoreWebPreviews(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Filter only image attachments",
                subLabel: "Includes only uploaded photos/GIFs (PNG, JPG, GIF, WEBP) and ignores other files",
                value: onlyImages,
                onValueChange: function (v) {
                    storage.onlyImages = v;
                    setOnlyImages(v);
                }
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormRow, {
                label: "Range: " + rangeLabel,
                subLabel: "Tap to toggle between Entire chat, Start to Pin, or Only Pins",
                onPress: cycleRange
            }),
            React.createElement(FormDivider, null),
            React.createElement(FormSwitchRow, {
                label: "Allow in server channels too",
                subLabel: "Restricted to Direct Messages (DMs) by default",
                value: allowServers,
                onValueChange: function (v) {
                    storage.allowServers = v;
                    setAllowServers(v);
                }
            })
        ),
        React.createElement(
            FormSection,
            { title: "EXPORT CURRENTLY OPEN DM" },
            React.createElement(FormRow, {
                label: "📥 Download current DM now",
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
                description: "Downloads the entire history of the current DM from start to finish",
                displayDescription: "Downloads the entire history of the current DM from start to finish",
                options: [
                    {
                        name: "format",
                        displayName: "format",
                        description: "Format: txt, json or md",
                        displayDescription: "Format: txt, json or md",
                        type: 3,
                        required: false
                    },
                    {
                        name: "images",
                        displayName: "images",
                        description: "Include uploaded images (true / false)",
                        displayDescription: "Include uploaded images (true / false)",
                        type: 5,
                        required: false
                    },
                    {
                        name: "mode",
                        displayName: "mode",
                        description: "all (entire chat), to_last_pin (start to pin), only_pins",
                        displayDescription: "all (entire chat), to_last_pin (start to pin), only_pins",
                        type: 3,
                        required: false
                    }
                ],
                applicationId: "-1",
                inputType: 1,
                type: 1,
                execute: function (args, ctx) {
                    const fmtArg = args && args.find(function (a) { return a.name === "format"; });
                    const imgArg = args && args.find(function (a) { return a.name === "images"; });
                    const modeArg = args && args.find(function (a) { return a.name === "mode"; });

                    const fmtVal = fmtArg && fmtArg.value;
                    const imgVal = imgArg && imgArg.value;
                    const modeVal = modeArg && modeArg.value;

                    const validFormat = (fmtVal === "json" || fmtVal === "txt" || fmtVal === "md") ? fmtVal : undefined;
                    const validMode = (modeVal === "all" || modeVal === "to_last_pin" || modeVal === "only_pins") ? modeVal : undefined;

                    runDMExport({
                        channelId: ctx && ctx.channel && ctx.channel.id,
                        format: validFormat,
                        includeImages: typeof imgVal === "boolean" ? imgVal : undefined,
                        rangeMode: validMode
                    });

                    return {
                        content: "⏳ **DMChatExporter:** Downloading DM history in the background..."
                    };
                }
            });
        } catch (e) {}
    },
    onUnload: function () {
        try {
            if (unregisterCommand) unregisterCommand();
        } catch (e) {}
    },
    settings: SettingsPanel
};
})(window.vendetta);
