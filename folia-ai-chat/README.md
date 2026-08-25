# Folia AI Chat

A Folia-compatible Minecraft plugin that sends messages beginning with `@bot`
to an OpenAI-compatible chat completion endpoint. Replies are sent to the game
chat as `<bot manager> ...`.

## Configure

1. Build the plugin with JDK 21 and Gradle: `gradle build`.
2. Put `build/libs/folia-ai-chat-1.0.0-all.jar` in the server `plugins/` directory.
3. Start the server once, then set `ai.api-key`, `ai.endpoint`, and `ai.model` in
   `plugins/FoliaAiChat/config.yml`.
4. Run `/botmanager reload` or restart the server.

`ai.endpoint` defaults to the standard OpenAI Chat Completions URL. Any
provider implementing the same API shape can be used by changing the endpoint,
model, and key. The key is only stored in the server's plugin configuration and
is never exposed in chat or logs.

## Use

In chat, enter:

```
@bot Where is the nearest village?
```

Prompts are hidden from public chat by default and AI responses are broadcast
as `bot manager`. Set `chat.broadcast-replies: false` to make replies private,
or `chat.hide-player-prompt: false` to leave prompts visible.

## 自动管理 Mineflayer 假人

插件会根据名字前缀识别假人，默认所有以 `Bot` 开头的玩家名都会触发自动管理。

机器人加入时（默认延迟 20 tick）执行：

```text
pvp <bot-name> off
lp user <bot-name> parent bot
```

机器人离开时执行反向命令：

```text
pvp <bot-name> on
lp user <bot-name> parent remove bot
```

配置位于 `plugins/FoliaAiChat/config.yml`：

```yaml
bots:
  name-prefix: "Bot"
  command-delay-ticks: 20
  on-join-commands:
    - "pvp %name% off"
    - "lp user %name% parent bot"
  on-quit-commands:
    - "pvp %name% on"
    - "lp user %name% parent remove bot"
```

命令由服务器控制台身份执行，不需要给假人 OP。`%name%` 会替换成实际游戏内玩家名。

