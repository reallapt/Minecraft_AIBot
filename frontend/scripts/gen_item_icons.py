#!/usr/bin/env python3
"""生成 Minecraft 风格物品像素图标（16x16 → 64x64 PNG，透明背景）。
用法: python gen_item_icons.py <输出目录>
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

PIXEL = 4
SIZE = 16


def new_canvas():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)


def shade(hex_color, factor):
    hex_color = hex_color.lstrip("#")
    r = min(255, max(0, int(int(hex_color[0:2], 16) * factor)))
    g = min(255, max(0, int(int(hex_color[2:4], 16) * factor)))
    b = min(255, max(0, int(int(hex_color[4:6], 16) * factor)))
    return f"#{r:02x}{g:02x}{b:02x}"


def draw_block(d, color):
    """方块：色块 + 深色边框 + 左上高光"""
    d.rectangle([1, 1, 14, 14], fill=color)
    d.rectangle([1, 1, 14, 14], outline=shade(color, 0.6))
    d.rectangle([2, 2, 13, 13], outline=shade(color, 0.85))
    d.polygon([(2, 2), (6, 2), (2, 6)], fill=shade(color, 1.35))
    d.polygon([(10, 2), (13, 2), (13, 5), (10, 2)], fill=shade(color, 1.2))
    d.point((13, 13), fill=shade(color, 0.5))


def draw_gem(d, color):
    """宝石：菱形 + 高光"""
    d.polygon([(8, 1), (14, 8), (8, 15), (2, 8)], fill=color, outline=shade(color, 0.5))
    d.polygon([(8, 3), (12, 8), (8, 13), (4, 8)], fill=shade(color, 0.8))
    d.polygon([(8, 4), (10, 8), (8, 12), (6, 8)], fill=shade(color, 1.15))
    d.polygon([(8, 5), (9, 8), (8, 11), (7, 8)], fill=shade(color, 1.4))


def draw_ingot(d, color):
    """锭：圆角横条"""
    d.rounded_rectangle([3, 6, 13, 10], radius=2, fill=color, outline=shade(color, 0.5))
    d.rounded_rectangle([4, 7, 12, 9], radius=1, fill=shade(color, 1.2))
    d.rectangle([3, 6, 6, 10], fill=color)


def draw_food(d, color):
    """食物：圆角块 + 高光条"""
    d.rounded_rectangle([2, 4, 14, 14], radius=3, fill=color, outline=shade(color, 0.5))
    d.rounded_rectangle([4, 6, 12, 12], radius=2, fill=shade(color, 1.15))
    d.rectangle([4, 6, 12, 7], fill=shade(color, 1.4))


def draw_tool(d, color, head_color=None):
    """工具：斜杆 + 头部方块"""
    head = head_color or color
    d.line([(3, 13), (12, 4)], fill=shade(color, 0.7), width=3)
    d.line([(3, 13), (12, 4)], fill=shade(color, 1.1), width=2)
    d.line([(3, 13), (12, 4)], fill=shade(color, 1.4), width=1)
    d.rectangle([10, 2, 14, 6], fill=head, outline=shade(head, 0.5))
    d.point((11, 3), fill=shade(head, 1.4))


def draw_misc(d, color):
    """杂项：圆形 + 高光"""
    d.ellipse([3, 3, 13, 13], fill=color, outline=shade(color, 0.5))
    d.ellipse([5, 5, 11, 11], fill=shade(color, 0.85))
    d.ellipse([6, 6, 8, 8], fill=shade(color, 1.5))


# 物品名 -> (主题色, 图案)
ITEMS = {
    # 矿物/材料
    "diamond": ("4aedd9", "gem"), "emerald": ("17dd62", "gem"), "lapis_lazuli": ("2f4fd8", "gem"),
    "redstone": ("c11212", "misc"), "coal": ("333333", "misc"), "charcoal": ("4a4a4a", "misc"),
    "quartz": ("e8e2d0", "gem"), "amethyst_shard": ("9a5cc7", "gem"), "netherite_ingot": ("4a3b35", "ingot"),
    "gold_ingot": ("f8c51c", "ingot"), "iron_ingot": ("d8d8d8", "ingot"), "copper_ingot": ("e0783a", "ingot"),
    "gold_nugget": ("f8c51c", "misc"), "iron_nugget": ("d8d8d8", "misc"), "netherite_scrap": ("3a2f2a", "misc"),
    "stick": ("8a6a3a", "tool"), "string": ("d8d8d8", "misc"), "flint": ("5a5a5a", "misc"),
    "paper": ("e8e8e0", "misc"), "book": ("7a4a2a", "block"), "slime_ball": ("7ad65a", "misc"),
    "ender_pearl": ("1a8a6a", "misc"), "blaze_rod": ("e8a020", "tool"), "bone": ("e8e0d0", "tool"),
    "feather": ("e8e8e8", "misc"), "leather": ("a06a3a", "block"), "rabbit_hide": ("d8c8b0", "block"),
    # 方块
    "dirt": ("8a5a3a", "block"), "grass_block": ("5a9a2a", "block"), "stone": ("8a8a8a", "block"),
    "cobblestone": ("7a7a7a", "block"), "sand": ("e8d8a0", "block"), "gravel": ("9a8a7a", "block"),
    "oak_log": ("8a6a3a", "block"), "oak_planks": ("c8a060", "block"), "glass": ("d8f8f8", "block"),
    "light_gray_concrete": ("9a9a9a", "block"), "gray_concrete": ("5a5a5a", "block"),
    "white_concrete": ("e8e8e8", "block"), "black_concrete": ("2a2a2a", "block"),
    "red_concrete": ("a03030", "block"), "blue_concrete": ("3030a0", "block"),
    "green_concrete": ("30a030", "block"), "yellow_concrete": ("e8c820", "block"),
    "obsidian": ("1a1030", "block"), "bedrock": ("3a3a3a", "block"), "netherrack": ("7a2a2a", "block"),
    "soul_sand": ("6a5a4a", "block"), "ice": ("a8e8f8", "block"), "snow_block": ("f8f8f8", "block"),
    "crafting_table": ("8a6a3a", "block"), "furnace": ("6a6a6a", "block"), "chest": ("b07830", "block"),
    "barrel": ("8a6a3a", "block"), "tnt": ("e03030", "block"), "torch": ("e8a020", "tool"),
    "ladder": ("c8a060", "block"), "bookshelf": ("b07830", "block"), "cactus": ("3a8a2a", "block"),
    "pumpkin": ("e87820", "block"), "melon": ("3a9a2a", "block"), "hay_block": ("e8c820", "block"),
    "sponge": ("e8d848", "block"), "clay": ("a8b8c8", "block"), "bricks": ("a05040", "block"),
    "mossy_cobblestone": ("6a8a5a", "block"), "deepslate": ("4a4a5a", "block"),
    # 食物
    "apple": ("e03030", "food"), "golden_apple": ("e8c020", "food"), "bread": ("d8a050", "food"),
    "beef": ("b04030", "food"), "cooked_beef": ("8a4a2a", "food"), "porkchop": ("e8a0a0", "food"),
    "cooked_porkchop": ("c87858", "food"), "chicken": ("e8d8c8", "food"), "cooked_chicken": ("d8b888", "food"),
    "carrot": ("e87820", "food"), "golden_carrot": ("e8c020", "food"), "potato": ("d8b878", "food"),
    "baked_potato": ("c89858", "food"), "wheat": ("e8d858", "food"), "wheat_seeds": ("c8a848", "misc"),
    "sugar": ("e8e8e8", "misc"), "egg": ("e8e0c8", "misc"), "milk_bucket": ("e8e8e8", "misc"),
    "cookie": ("c88840", "food"), "cake": ("f8e0e0", "food"), "melon_slice": ("7ac85a", "food"),
    "sweet_berries": ("d03040", "misc"), "honey_bottle": ("e8a020", "misc"),
    # 工具/武器
    "diamond_pickaxe": ("4aedd9", "tool"), "iron_pickaxe": ("d8d8d8", "tool"), "golden_pickaxe": ("f8c51c", "tool"),
    "stone_pickaxe": ("8a8a8a", "tool"), "wooden_pickaxe": ("c8a060", "tool"), "netherite_pickaxe": ("4a3b35", "tool"),
    "diamond_sword": ("4aedd9", "tool"), "iron_sword": ("d8d8d8", "tool"), "golden_sword": ("f8c51c", "tool"),
    "stone_sword": ("8a8a8a", "tool"), "wooden_sword": ("c8a060", "tool"), "netherite_sword": ("4a3b35", "tool"),
    "bow": ("8a6a3a", "tool"), "arrow": ("d8d8d8", "tool"), "shield": ("8a8a8a", "block"),
    "fishing_rod": ("8a6a3a", "tool"), "shears": ("d8d8d8", "tool"), "flint_and_steel": ("5a5a5a", "tool"),
    # 盔甲
    "diamond_helmet": ("4aedd9", "gem"), "diamond_chestplate": ("4aedd9", "block"), "diamond_leggings": ("4aedd9", "block"),
    "diamond_boots": ("4aedd9", "block"), "iron_helmet": ("d8d8d8", "gem"), "iron_chestplate": ("d8d8d8", "block"),
    "leather_helmet": ("a06a3a", "gem"), "leather_chestplate": ("a06a3a", "block"),
    # 杂项
    "bucket": ("8a8a8a", "misc"), "water_bucket": ("4a88e8", "misc"), "lava_bucket": ("e85820", "misc"),
    "compass": ("d8d8d8", "misc"), "clock": ("e8d848", "misc"), "map": ("e8e0c0", "misc"),
    "name_tag": ("e8e0c0", "misc"), "saddle": ("8a5a2a", "misc"), "lead": ("e8e8e8", "misc"),
    "experience_bottle": ("7ad65a", "misc"), "ender_eye": ("3aa878", "misc"), "ghast_tear": ("f0f0f0", "misc"),
    "nether_star": ("e8e8f8", "gem"), "dragon_breath": ("9a4ad8", "misc"), "elytra": ("8a8a8a", "block"),
    "totem_of_undying": ("e8d848", "gem"), "heart_of_the_sea": ("3a9ad8", "gem"),
}


def draw_item(name: str, color: str, kind: str) -> Image.Image:
    img, d = new_canvas()
    color = f"#{color}"
    if kind == "block":
        draw_block(d, color)
    elif kind == "gem":
        draw_gem(d, color)
    elif kind == "ingot":
        draw_ingot(d, color)
    elif kind == "food":
        draw_food(d, color)
    elif kind == "tool":
        draw_tool(d, color)
    else:
        draw_misc(d, color)
    return img.resize((SIZE * PIXEL, SIZE * PIXEL), Image.NEAREST)


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for name, (color, kind) in sorted(ITEMS.items()):
        img = draw_item(name, color, kind)
        img.save(out / f"{name}.png")
        count += 1
    # 兜底图标（未知物品）
    img, d = new_canvas()
    d.rectangle([1, 1, 14, 14], fill="#8a8a8a", outline="#4a4a4a")
    d.text((3, 3), "?", fill="#2a2a2a")
    img.resize((SIZE * PIXEL, SIZE * PIXEL), Image.NEAREST).save(out / "_unknown.png")
    print(f"生成 {count + 1} 个图标 → {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "items")
