"""
Tải các category Quick, Draw! (định dạng raw .ndjson - có timestamp)
dùng cho demo GMM-HMM nhận dạng hình vẽ tay.

Yêu cầu: pip install requests
Chạy: python download_quickdraw.py
"""

import os
import requests

# Thư mục lưu dữ liệu
OUTPUT_DIR = "data"


CATEGORIES =  ["circle", "square", "triangle", "zigzag","envelope"]

BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/raw/{}.ndjson"


def download_category(category: str, output_dir: str) -> None:
    """Tải 1 file .ndjson cho 1 category, có hiển thị tiến trình tải."""
    # Category có khoảng trắng (vd "smiley face") -> encode thành %20 trong URL
    url = BASE_URL.format(category.replace(" ", "%20"))
    # Tên file lưu: bỏ khoảng trắng để dễ dùng trong code sau này
    filename = category.replace(" ", "_") + ".ndjson"
    filepath = os.path.join(output_dir, filename)

    if os.path.exists(filepath):
        print(f"[BỎ QUA] {filename} đã tồn tại.")
        return

    print(f"[ĐANG TẢI] {category} -> {filename}")
    response = requests.get(url, stream=True, timeout=60)
    response.raise_for_status()

    total_size = int(response.headers.get("content-length", 0))
    downloaded = 0

    with open(filepath, "wb") as f:
        for chunk in response.iter_content(chunk_size=1024 * 1024):  # 1MB/lần
            if chunk:
                f.write(chunk)
                downloaded += len(chunk)
                if total_size:
                    percent = downloaded / total_size * 100
                    print(f"\r  {downloaded / 1e6:.1f}MB / {total_size / 1e6:.1f}MB ({percent:.1f}%)", end="")
    print(f"\n[XONG] {filename}")


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"Sẽ tải {len(CATEGORIES)} category vào: {OUTPUT_DIR}\n")

    for category in CATEGORIES:
        try:
            download_category(category, OUTPUT_DIR)
        except requests.exceptions.RequestException as e:
            print(f"[LỖI] Không tải được '{category}': {e}")

    print("\nHoàn tất tải dữ liệu.")


if __name__ == "__main__":
    main()