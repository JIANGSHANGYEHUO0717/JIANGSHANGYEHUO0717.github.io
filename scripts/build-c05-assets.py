from pathlib import Path
from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / "outputs" / "c05-foundation-study" / "model-analysis"
DEST = ROOT / "public" / "assets" / "observation"
DEST.mkdir(parents=True, exist_ok=True)

base_path = SOURCE / "01-coral-like_sculpture_3d_model_basecolor.jpg"
normal_path = SOURCE / "00-coral-like_sculpture_3d_model_normal.jpg"
surface_path = SOURCE / "02-coral-like_sculpture_3d_model_metallic-coral-like_sculpture_3d_model_roughness.png"

base = Image.open(base_path).convert("RGB")
hue, saturation, value = base.convert("HSV").split()

def ramp(channel, low, high, invert=False):
    scale = max(1, high - low)
    lut = []
    for sample in range(256):
        amount = max(0.0, min(1.0, (sample - low) / scale))
        if invert:
            amount = 1.0 - amount
        lut.append(round(amount * 255))
    return channel.point(lut)

def hue_window(low, high, feather=12):
    lut = []
    for sample in range(256):
        if low <= sample <= high:
            amount = 1.0
        elif low - feather <= sample < low:
            amount = (sample - (low - feather)) / feather
        elif high < sample <= high + feather:
            amount = ((high + feather) - sample) / feather
        else:
            amount = 0.0
        lut.append(round(max(0.0, min(1.0, amount)) * 255))
    return hue.point(lut)

high_value = ramp(value, 132, 214)
low_saturation = ramp(saturation, 24, 96, invert=True)
bone = ImageChops.multiply(high_value, low_saturation)

warm_hue = ImageChops.lighter(hue_window(0, 28, 10), hue_window(240, 255, 8))
warm = ImageChops.multiply(warm_hue, ramp(saturation, 45, 150))
warm = ImageChops.multiply(warm, ramp(value, 38, 120))

green_hue = hue_window(34, 112, 18)
velvet = ImageChops.multiply(green_hue, ramp(saturation, 18, 105))
velvet = ImageChops.multiply(velvet, ramp(value, 30, 150))
velvet = ImageChops.subtract(velvet, bone.point(lambda p: round(p * 0.55)))
velvet = ImageChops.subtract(velvet, warm.point(lambda p: round(p * 0.72)))

occupied = ImageChops.lighter(bone, ImageChops.lighter(velvet, warm))
substrate = ImageOps.invert(occupied.point(lambda p: min(255, round(p * 0.86))))
substrate = ImageChops.lighter(substrate, ramp(value, 42, 116).point(lambda p: round(p * 0.22)))

mask = Image.merge("RGBA", (substrate, bone, velvet, warm))
mask.save(SOURCE / "category-5-material-mask.png", optimize=True)

web_size = (2048, 2048)
base.resize(web_size, Image.Resampling.LANCZOS).save(DEST / "category-5-basecolor.jpg", quality=94, optimize=True)
Image.open(normal_path).convert("RGB").resize(web_size, Image.Resampling.LANCZOS).save(DEST / "category-5-normal.jpg", quality=94, optimize=True)
Image.open(surface_path).convert("RGB").resize(web_size, Image.Resampling.LANCZOS).save(DEST / "category-5-surface.png", optimize=True)
mask.resize(web_size, Image.Resampling.LANCZOS).save(DEST / "category-5-material-mask.png", optimize=True)

preview = Image.new("RGB", base.size, (52, 58, 48))
preview = Image.blend(preview, Image.merge("RGB", (substrate, substrate, substrate)), 0.35)
preview = ImageChops.add(preview, Image.merge("RGB", (
    warm.point(lambda p: round(p * .72)),
    bone.point(lambda p: round(p * .78)),
    velvet.point(lambda p: round(p * .62)),
)), scale=1.35)
preview.thumbnail((1200, 1200))
preview.save(SOURCE / "mask-preview.jpg", quality=92)

print(DEST / "category-5-material-mask.png")
