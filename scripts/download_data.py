import hashlib
import os
import shutil
import urllib.request
import zipfile

from config.params import BASE_DIR, PATH

# UCI ElectricityLoadDiagrams20112014 (https://archive.ics.uci.edu/dataset/321)
DATA_URL = "https://archive.ics.uci.edu/static/public/321/electricityloaddiagrams20112014.zip"
RAW_FILE = "LD2011_2014.txt"
# SHA-256 of the extracted LD2011_2014.txt, recorded 2026-11-16
RAW_SHA256 = "d51565f2cb5a6b768d06ba1bbd3c084c6e2f3aab07f00c6f2dcb80e90175124b"


def sha256_of(path, chunk_size=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def download_data():
    raw_dir = os.path.join(BASE_DIR, PATH["raw_data_folder"])
    raw_path = os.path.join(raw_dir, RAW_FILE)
    os.makedirs(raw_dir, exist_ok=True)

    if not os.path.exists(raw_path):
        # Reuse a copy already placed in the project root (the March README asked for that location)
        legacy_path = os.path.join(BASE_DIR, RAW_FILE)
        if os.path.exists(legacy_path):
            print(f"Copying existing {legacy_path} -> {raw_path}")
            shutil.copyfile(legacy_path, raw_path)
        else:
            zip_path = os.path.join(raw_dir, "electricityloaddiagrams20112014.zip")
            print(f"Downloading {DATA_URL} (about 250 MB) ...")
            urllib.request.urlretrieve(DATA_URL, zip_path)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extract(RAW_FILE, raw_dir)
            os.remove(zip_path)

    digest = sha256_of(raw_path)
    if digest != RAW_SHA256:
        raise ValueError(f"SHA-256 mismatch for {raw_path}: expected {RAW_SHA256}, got {digest}")
    print(f"OK: {raw_path} (SHA-256 verified)")


if __name__ == "__main__":
    download_data()
