# Photo test prep: fix rotation, make resized copies, print token and cost estimates.
# Usage: python3 tools/photo-test/prep.py <in_dir> <out_dir>
import math
import os
import sys

from PIL import Image, ImageOps

EXTS = (".jpg", ".jpeg", ".png", ".webp")
SIZES = (1500, 1000, 768)  # longest side in px
HAIKU_IN = 0.10  # USD per million input tokens


# Same formula as estimateTokens() in lib.js
def est_tokens(w, h):
    scale = min(1, 1568 / max(w, h), math.sqrt(1150000 / (w * h)))
    return math.floor(w * scale * h * scale / 750 + 0.5)


def main(argv):
    if len(argv) != 2:
        print("usage: python3 tools/photo-test/prep.py <in_dir> <out_dir>")
        return 1
    in_dir, out_dir = argv
    names = sorted(f for f in os.listdir(in_dir) if f.lower().endswith(EXTS))
    if not names:
        print(f"no photos in {in_dir}")
        return 1

    folders = ["original"] + [str(s) for s in SIZES]
    for f in folders:
        os.makedirs(os.path.join(out_dir, f), exist_ok=True)

    kb = {f: 0.0 for f in folders}
    toks = {f: [] for f in folders}
    print(f"{'file':<24}" + "".join(f"{f:>22}" for f in folders))

    for name in names:
        with Image.open(os.path.join(in_dir, name)) as src:
            # convert() always returns a fresh in-memory copy, so the file can close
            im = ImageOps.exif_transpose(src).convert("RGB")
        out_name = os.path.splitext(name)[0] + ".jpg"

        variants = {"original": im}
        for s in SIZES:
            longest = max(im.size)
            if longest <= s:
                variants[str(s)] = im  # never upscale
            else:
                scale = s / longest
                size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
                variants[str(s)] = im.resize(size, Image.LANCZOS)

        cells = []
        for f in folders:
            v = variants[f]
            p = os.path.join(out_dir, f, out_name)
            v.save(p, "JPEG", quality=92 if f == "original" else 85)
            size_kb = os.path.getsize(p) / 1024
            tok = est_tokens(*v.size)
            kb[f] += size_kb
            toks[f].append(tok)
            cells.append(f"{size_kb:7.1f} KB {tok:6d} tok")
        print(f"{name:<24}" + "".join(f"{c:>22}" for c in cells))

    print()
    for f in folders:
        avg = sum(toks[f]) / len(toks[f])
        cost = avg * HAIKU_IN / 1e6
        print(f"{f:<10} total {kb[f]:,.1f} KB   ~${cost:.6f} per photo (Haiku, avg {avg:.0f} tok)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
