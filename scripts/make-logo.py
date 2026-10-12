# Porter logo pipeline: source PNG (green glyph on transparent bg) -> trim -> sized PNGs.
# The source ships with a real alpha channel, so no matting work is needed here;
# this trims, samples the brand green, and emits the size set.
from PIL import Image
import os

SRC = r"C:\Users\jrnew\Downloads\Curtis.ai.porter.png"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")

bbox = img.getbbox()
if bbox is None:
    raise SystemExit("source is fully transparent")
img = img.crop(bbox)
img = img.resize((512, 512), Image.LANCZOS)

# Sample the glyph color from solid interior pixels.
px = img.load()
solid = [px[x, y][:3] for y in range(0, img.height, 4) for x in range(0, img.width, 4) if px[x, y][3] >= 250]
if not solid:
    raise SystemExit("no solid pixels found")
solid.sort(key=lambda c: c[1], reverse=True)
core = solid[len(solid) // 20]
print("brand green: #%02x%02x%02x" % core)

img.save(os.path.join(OUT, "porter-logo.png"))
img.save(os.path.join(OUT, "porter-logo-512.png"))
img.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "porter-logo-64.png"))
img.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, "favicon-32.png"))
print("wrote assets/: porter-logo.png 512, 512, 64, favicon-32")
