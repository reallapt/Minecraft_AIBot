package com.mccontrol.foliaaichat;

import java.util.List;
import org.bukkit.configuration.file.FileConfiguration;

record Settings(
    String endpoint,
    String apiKey,
    String model,
    String systemPrompt,
    int requestTimeoutSeconds,
    int maxHistoryMessages,
    int maxResponseCharacters,
    String trigger,
    boolean hidePlayerPrompt,
    boolean broadcastReplies,
    int cooldownSeconds,
    int maxPromptCharacters,
    int maxLineCharacters,
    String replyName,
    String botNamePrefix,
    List<String> botOnJoinCommands,
    List<String> botOnQuitCommands,
    int botCommandDelayTicks
) {
    static Settings from(FoliaAiChatPlugin plugin) {
        FileConfiguration config = plugin.getConfig();
        return new Settings(
            nonBlank(config.getString("ai.endpoint"), "https://api.openai.com/v1/chat/completions"),
            config.getString("ai.api-key", "").trim(),
            nonBlank(config.getString("ai.model"), "gpt-4.1-mini"),
            nonBlank(config.getString("ai.system-prompt"), "You are bot manager, a helpful Minecraft server assistant."),
            positive(config.getInt("ai.request-timeout-seconds", 30), 30),
            positive(config.getInt("ai.max-history-messages", 10), 10),
            positive(config.getInt("ai.max-response-characters", 800), 800),
            nonBlank(config.getString("chat.trigger"), "@bot"),
            config.getBoolean("chat.hide-player-prompt", true),
            config.getBoolean("chat.broadcast-replies", true),
            Math.max(0, config.getInt("chat.cooldown-seconds", 2)),
            positive(config.getInt("chat.max-prompt-characters", 1000), 1000),
            positive(config.getInt("chat.max-line-characters", 240), 240),
            nonBlank(config.getString("chat.reply-name"), "bot manager"),
            nonBlank(config.getString("bots.name-prefix"), "Bot"),
            config.getStringList("bots.on-join-commands"),
            config.getStringList("bots.on-quit-commands"),
            Math.max(0, config.getInt("bots.command-delay-ticks", 20))
        );
    }

    private static String nonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static int positive(int value, int fallback) {
        return value > 0 ? value : fallback;
    }
}
