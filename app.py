import os
import numpy as np
from flask import Flask, render_template, request, jsonify

from train_quickdraw import load_models, predict

app = Flask(__name__)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "data", "training_output", "gmm_hmm_models.pkl")

MODELS = None
try:
    MODELS = load_models(MODEL_PATH)
    print(f"[OK] Đã nạp {len(MODELS)} model: {list(MODELS.keys())}")
except FileNotFoundError:
    print(f"[CẢNH BÁO] Không tìm thấy model tại {MODEL_PATH}. "
          f"Hãy chạy train_quickdraw.py trước để tạo file này.")


@app.route("/")
def main():
    return render_template("main.html")


@app.route("/recognize", methods=["POST"])
def recognize():
    """Nhận toạ độ các nét vẽ từ frontend, trả về lớp được nhận diện."""
    if MODELS is None:
        return jsonify({"error": "Model chưa được nạp. Hãy train model trước."}), 503

    data = request.get_json(silent=True) or {}
    strokes = data.get("strokes", [])

    # Gộp toạ độ tất cả các nét thành 1 chuỗi điểm liên tục, đúng thứ tự vẽ
    points = []
    for stroke in strokes:
        for p in stroke.get("points", []):
            points.append((p["x"], p["y"]))

    if len(points) < 4:
        return jsonify({"error": "Chưa đủ điểm để nhận diện."}), 400

    points = np.array(points, dtype=float)

    predicted_category, scores = predict(points, MODELS)

    # Chuyển log-likelihood thành phần trăm "độ tin cậy" dễ hiểu hơn
    log_vals = np.array(list(scores.values()))
    log_vals -= log_vals.max()          # tránh tràn số khi exp()
    probs = np.exp(log_vals)
    probs /= probs.sum()
    confidence = {cat: float(p) for cat, p in zip(scores.keys(), probs)}

    return jsonify({
        "category": predicted_category,
        "confidence": round(confidence[predicted_category] * 100, 1),
        "all_scores": {cat: round(c * 100, 1) for cat, c in confidence.items()},
    })


if __name__ == "__main__":
    app.run(debug=True)