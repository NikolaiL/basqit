"""Refresh Jev's visible-logo color context: python3 scripts/extract-logo-colors.py (requires Pillow)."""
import colorsys
import json
from collections import Counter
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def color_name(red, green, blue):
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    hue *= 360
    if value < 0.18:
        return "black"
    if saturation < 0.22:
        return "white" if value > 0.88 else "gray" if value > 0.35 else "black"
    if hue < 15 or hue >= 345:
        return "red"
    if hue < 45:
        return "brown" if value < 0.65 else "orange"
    if hue < 70:
        return "yellow"
    if hue < 170:
        return "green"
    if hue < 200:
        return "cyan"
    if hue < 265:
        return "blue"
    if hue < 290:
        return "purple"
    return "pink"


def logo_colors(image):
    counts = Counter()
    for red, green, blue, alpha in image.convert("RGBA").getdata():
        if alpha >= 128:
            counts[color_name(red, green, blue)] += alpha / 255
    # Ignore neutral padding when identifying colored marks. Pure monochrome marks retain their ink color.
    chromatic = Counter({key: value for key, value in counts.items() if key not in ("white", "gray", "black")})
    palette = chromatic if sum(chromatic.values()) >= sum(counts.values()) * 0.03 else Counter({k: v for k, v in counts.items() if k != "white"}) or counts
    total = sum(palette.values())
    return [name for name, count in palette.most_common() if count / total >= 0.1] if total else []


if __name__ == "__main__":
    assert color_name(255, 128, 0) == "orange"
    assert color_name(100, 50, 0) == "brown"
    assert color_name(0, 200, 0) == "green"
    assert logo_colors(Image.new("RGBA", (2, 2), (255, 128, 0, 0))) == []
    assert logo_colors(Image.new("RGBA", (2, 2), (255, 128, 0, 255))) == ["orange"]
    logos = json.loads((ROOT / "services/discover/logos.json").read_text())
    result = {}
    for symbol, path in logos.items():
        colors = logo_colors(Image.open(ROOT / "public" / path.lstrip("/")))
        result[symbol] = {"colors": colors, "dominantColor": colors[0] if colors else None}
    assert "orange" in result["P"]["colors"]
    assert "green" in result["NVDA"]["colors"]
    (ROOT / "services/discover/logo-colors.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f"Extracted logo colors for {len(result)} tokens; color checks passed.")
    print("Orange:", ", ".join(s for s, r in result.items() if "orange" in r["colors"]))
