package com.mccontrol.foliaaichat;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabExecutor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

/** Folia-safe chat bridge for OpenAI-compatible chat completion APIs. */
public final class FoliaAiChatPlugin extends JavaPlugin implements Listener, TabExecutor {
    private static final PlainTextComponentSerializer PLAIN_TEXT = PlainTextComponentSerializer.plainText();

    private static final List<String> DEFAULT_ON_JOIN = List.of(
        "pvp %name% off",
        "lp user %name% parent bot"
    );
    private static final List<String> DEFAULT_ON_QUIT = List.of(
        "pvp %name% on",
        "lp user %name% parent remove bot"
    );

    private final Map<UUID, Deque<ChatMessage>> histories = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastRequests = new ConcurrentHashMap<>();
    private final HttpClient httpClient = HttpClient.newBuilder().build();
    private volatile Settings settings;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        reloadSettings();
        getServer().getPluginManager().registerEvents(this, this);
        getCommand("botmanager").setExecutor(this);
        getCommand("botmanager").setTabCompleter(this);
        getLogger().info("Folia AI chat enabled. Players can use " + settings.trigger() + " <message>.");
    }

    @Override
    public void onDisable() {
        histories.clear();
        lastRequests.clear();
    }

    @EventHandler(ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        Player player = event.getPlayer();
        if (!player.hasPermission("foliaaichat.use")) {
            return;
        }

        String rawMessage = PLAIN_TEXT.serialize(event.originalMessage());
        String prompt = extractPrompt(rawMessage);
        if (prompt == null) {
            return;
        }

        if (settings.hidePlayerPrompt()) {
            event.setCancelled(true);
        }
        if (prompt.isBlank()) {
            tellPlayer(player, Component.text("Usage: " + settings.trigger() + " <message>", NamedTextColor.YELLOW));
            return;
        }
        if (prompt.length() > settings.maxPromptCharacters()) {
            tellPlayer(player, Component.text("Your message is too long.", NamedTextColor.RED));
            return;
        }
        if (!isConfigured()) {
            tellPlayer(player, Component.text("The AI service is not configured yet.", NamedTextColor.RED));
            return;
        }
        if (!claimCooldown(player.getUniqueId())) {
            tellPlayer(player, Component.text("Please wait before asking again.", NamedTextColor.YELLOW));
            return;
        }

        askAi(player, prompt);
    }

    /** 机器人加入服务器：自动执行 PvP 关闭 + LuckPerms bot 组（添加假人）。 */
    @EventHandler
    public void onBotJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String name = player.getName();
        if (!isBotName(name)) {
            return;
        }
        List<String> commands = settings.botOnJoinCommands();
        if (commands.isEmpty()) {
            commands = DEFAULT_ON_JOIN;
        }
        getLogger().info("Bot joined, running auto-setup for " + name + ": " + commands);
        runBotCommands(name, commands, settings.botCommandDelayTicks());
    }

    /** 机器人离开服务器：自动执行反向命令（删除假人）。 */
    @EventHandler
    public void onBotQuit(PlayerQuitEvent event) {
        String name = event.getPlayer().getName();
        if (!isBotName(name)) {
            return;
        }
        List<String> commands = settings.botOnQuitCommands();
        if (commands.isEmpty()) {
            commands = DEFAULT_ON_QUIT;
        }
        getLogger().info("Bot quit, running auto-cleanup for " + name + ": " + commands);
        runBotCommands(name, commands, settings.botCommandDelayTicks());
    }

    private boolean isBotName(String name) {
        String prefix = settings.botNamePrefix();
        return !prefix.isBlank() && name != null && name.startsWith(prefix);
    }

    /** 延迟执行一组控制台命令（Folia-safe：调度到全局区域线程）。 */
    private void runBotCommands(String playerName, List<String> commands, int delayTicks) {
        List<String> resolved = commands.stream()
            .map(command -> command.replace("%name%", playerName))
            .toList();
        if (delayTicks > 0) {
            getServer().getGlobalRegionScheduler().runDelayed(this, task -> {
                for (String command : resolved) {
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
                }
            }, delayTicks);
        } else {
            getServer().getGlobalRegionScheduler().execute(this, () -> {
                for (String command : resolved) {
                    Bukkit.dispatchCommand(Bukkit.getConsoleSender(), command);
                }
            });
        }
    }

    private void askAi(Player player, String prompt) {
        UUID playerId = player.getUniqueId();
        String requestBody = createRequestBody(playerId, prompt);
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(URI.create(settings.endpoint()))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + settings.apiKey())
                .timeout(Duration.ofSeconds(settings.requestTimeoutSeconds()))
                .POST(HttpRequest.BodyPublishers.ofString(requestBody, StandardCharsets.UTF_8))
                .build();
        } catch (IllegalArgumentException error) {
            getLogger().warning("Invalid AI endpoint: " + error.getMessage());
            tellPlayer(player, Component.text("The AI endpoint is invalid.", NamedTextColor.RED));
            return;
        }

        httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
            .whenComplete((response, error) -> {
                if (error != null) {
                    getLogger().warning("AI request failed: " + error.getMessage());
                    tellPlayer(player, Component.text("bot manager could not reach the AI service.", NamedTextColor.RED));
                    return;
                }
                if (response.statusCode() < 200 || response.statusCode() >= 300) {
                    getLogger().warning("AI endpoint returned HTTP " + response.statusCode() + ": " + shorten(response.body(), 300));
                    tellPlayer(player, Component.text("bot manager is unavailable right now.", NamedTextColor.RED));
                    return;
                }

                try {
                    String answer = extractResponse(response.body());
                    remember(playerId, "user", prompt);
                    remember(playerId, "assistant", answer);
                    sendReply(player, answer);
                } catch (RuntimeException parseError) {
                    getLogger().warning("Could not read AI response: " + parseError.getMessage());
                    tellPlayer(player, Component.text("bot manager returned an unreadable response.", NamedTextColor.RED));
                }
            });
    }

    private String createRequestBody(UUID playerId, String prompt) {
        JsonObject request = new JsonObject();
        request.addProperty("model", settings.model());
        JsonArray messages = new JsonArray();
        messages.add(message("system", settings.systemPrompt()));
        Deque<ChatMessage> history = histories.get(playerId);
        if (history != null) {
            synchronized (history) {
                for (ChatMessage item : history) {
                    messages.add(message(item.role(), item.content()));
                }
            }
        }
        messages.add(message("user", prompt));
        request.add("messages", messages);
        return request.toString();
    }

    private static JsonObject message(String role, String content) {
        JsonObject message = new JsonObject();
        message.addProperty("role", role);
        message.addProperty("content", content);
        return message;
    }

    private String extractResponse(String responseBody) {
        JsonObject root = JsonParser.parseString(responseBody).getAsJsonObject();
        JsonArray choices = root.getAsJsonArray("choices");
        if (choices == null || choices.isEmpty()) {
            throw new IllegalArgumentException("response does not contain choices");
        }
        JsonElement content = choices.get(0).getAsJsonObject().getAsJsonObject("message").get("content");
        String answer = contentToString(content).trim();
        if (answer.isEmpty()) {
            throw new IllegalArgumentException("response content is empty");
        }
        return shorten(answer, settings.maxResponseCharacters());
    }

    private static String contentToString(JsonElement content) {
        if (content == null || content.isJsonNull()) {
            return "";
        }
        if (content.isJsonPrimitive()) {
            return content.getAsString();
        }
        if (content.isJsonArray()) {
            StringBuilder text = new StringBuilder();
            for (JsonElement part : content.getAsJsonArray()) {
                if (part.isJsonObject() && part.getAsJsonObject().has("text")) {
                    text.append(part.getAsJsonObject().get("text").getAsString());
                }
            }
            return text.toString();
        }
        return "";
    }

    private void sendReply(Player player, String answer) {
        for (String line : wrapLines(answer, settings.maxLineCharacters())) {
            Component reply = Component.text("<" + settings.replyName() + "> ", NamedTextColor.AQUA)
                .append(Component.text(line, NamedTextColor.WHITE));
            if (settings.broadcastReplies()) {
                getServer().getGlobalRegionScheduler().execute(this, () -> Bukkit.broadcast(reply));
            } else {
                tellPlayer(player, reply);
            }
        }
    }

    private void tellPlayer(Player player, Component message) {
        player.getScheduler().run(this, task -> {
            if (player.isOnline()) {
                player.sendMessage(message);
            }
        }, null);
    }

    private String extractPrompt(String rawMessage) {
        Pattern trigger = Pattern.compile("^\\s*" + Pattern.quote(settings.trigger()) + "(?:\\s+(.*)|\\s*)$", Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
        Matcher matcher = trigger.matcher(rawMessage);
        return matcher.matches() ? matcher.group(1) == null ? "" : matcher.group(1).trim() : null;
    }

    private boolean claimCooldown(UUID playerId) {
        long now = System.currentTimeMillis();
        long cooldownMillis = settings.cooldownSeconds() * 1_000L;
        AtomicBoolean accepted = new AtomicBoolean(false);
        lastRequests.compute(playerId, (ignored, previous) -> {
            if (previous == null || now - previous >= cooldownMillis) {
                accepted.set(true);
                return now;
            }
            return previous;
        });
        return accepted.get();
    }

    private void remember(UUID playerId, String role, String content) {
        Deque<ChatMessage> history = histories.computeIfAbsent(playerId, ignored -> new ArrayDeque<>());
        synchronized (history) {
            history.addLast(new ChatMessage(role, content));
            while (history.size() > settings.maxHistoryMessages()) {
                history.removeFirst();
            }
        }
    }

    private boolean isConfigured() {
        return !settings.apiKey().isBlank() && !settings.endpoint().isBlank() && !settings.model().isBlank();
    }

    private void reloadSettings() {
        reloadConfig();
        settings = Settings.from(this);
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (args.length == 1 && args[0].equalsIgnoreCase("reload")) {
            reloadSettings();
            sender.sendMessage(Component.text("Folia AI chat configuration reloaded.", NamedTextColor.GREEN));
            return true;
        }
        sender.sendMessage(Component.text("Usage: /botmanager reload", NamedTextColor.YELLOW));
        return true;
    }

    @Override
    public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        return args.length == 1 ? List.of("reload") : List.of();
    }

    private static List<String> wrapLines(String answer, int maxLength) {
        List<String> lines = new ArrayList<>();
        for (String sourceLine : answer.replace('\r', '\n').split("\\n+")) {
            String remaining = sourceLine.trim();
            while (remaining.length() > maxLength) {
                int boundary = remaining.lastIndexOf(' ', maxLength);
                if (boundary < maxLength / 2) {
                    boundary = maxLength;
                }
                lines.add(remaining.substring(0, boundary).trim());
                remaining = remaining.substring(boundary).trim();
            }
            if (!remaining.isEmpty()) {
                lines.add(remaining);
            }
        }
        return lines.isEmpty() ? List.of("...") : lines;
    }

    private static String shorten(String value, int maxLength) {
        return value.length() <= maxLength ? value : value.substring(0, maxLength).trim() + "...";
    }

    private record ChatMessage(String role, String content) {}
}
