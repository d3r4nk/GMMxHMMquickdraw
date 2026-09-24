import os
import json
import pickle
import numpy as np
import matplotlib.pyplot as plt
from scipy.special import logsumexp
# 1. CẤU HÌNH
BASE_DIR = os.path.dirname(os.path.abspath(__file__))   
DATA_DIR = os.path.join(BASE_DIR, "data")               
OUTPUT_DIR = os.path.join(DATA_DIR, "training_output")  
CATEGORIES = ["circle", "square", "triangle", "zigzag" , "envelope"]
SAMPLES_PER_CLASS = 200      # số mẫu vẽ tối đa đọc từ mỗi file .ndjson
TEST_RATIO = 0.2             # tỉ lệ tách tập test
N_STATES = 4                 # số trạng thái ẩn 
N_MIX = 2                    # số Gaussian component trong GMM của mỗi trạng thái
SELF_LOOP_PROB = 0.65        # xác suất ở lại trạng thái hiện tại 

EM_MAX_ITER = 100
EM_TOL = 1e-5
RANDOM_STATE = 42

MIN_POINTS_PER_SEQUENCE = N_STATES * 3   # bỏ mẫu vẽ quá ít điểm

MODEL_PATH = os.path.join(OUTPUT_DIR, "gmm_hmm_models.pkl")  
# 2. GMM CÀI ĐẶT THỦ CÔNG
def gaussian_pdf(x, mean, cov):
    """Tính giá trị mật độ Gaussian đa biến cho một hoặc nhiều điểm."""
    x = np.asarray(x, dtype=float)
    mean = np.asarray(mean, dtype=float)
    cov = np.asarray(cov, dtype=float)

    original_shape = x.shape
    if x.ndim == 1:
        x = x.reshape(1, -1)

    diff = x - mean
    sign, logdet = np.linalg.slogdet(cov)
    if sign <= 0:
        cov = cov + 1e-6 * np.eye(cov.shape[0])
        sign, logdet = np.linalg.slogdet(cov)

    inv_cov = np.linalg.inv(cov)
    quad = np.einsum('ij,jk,ik->i', diff, inv_cov, diff)
    d = mean.shape[0]
    log_pdf = -0.5 * (d * np.log(2 * np.pi) + logdet + quad)
    vals = np.exp(log_pdf)
    return float(vals[0]) if original_shape == (d,) else vals
def e_step(X, pi, means, covs):
    """E-step: tính responsibility R[n, k] = p(z_n=k | x_n, theta)."""
    N, D = X.shape
    K = len(pi)
    log_prob = np.empty((N, K))
    for k in range(K):
        pdf = gaussian_pdf(X, means[k], covs[k])
        pdf = np.clip(pdf, 1e-300, None)
        log_prob[:, k] = np.log(np.clip(pi[k], 1e-300, None)) + np.log(pdf)
    log_total = logsumexp(log_prob, axis=1, keepdims=True)
    R = np.exp(log_prob - log_total)
    return R
def m_step(X, R):
    """M-step: cập nhật pi, means, covs từ R[n, k]."""
    N, D = X.shape
    K = R.shape[1]
    Nk = R.sum(axis=0)

    pi = Nk / N
    means = np.empty((K, D))
    covs = np.empty((K, D, D))
    for k in range(K):
        if Nk[k] < 1e-12:
            means[k] = X.mean(axis=0)
            covs[k] = np.cov(X.T) + 1e-6 * np.eye(D)
            continue
        means[k] = (R[:, k][:, None] * X).sum(axis=0) / Nk[k]
        diff = X - means[k]
        cov = (R[:, k][:, None, None] * diff[:, :, None] * diff[:, None, :]).sum(axis=0) / Nk[k]
        cov = 0.5 * (cov + cov.T)
        cov += 1e-6 * np.eye(D)
        covs[k] = cov

    return pi, means, covs
def log_likelihood(X, pi, means, covs):
    """Tính log-likelihood của toàn bộ dữ liệu."""
    total = np.zeros(X.shape[0])
    for k in range(len(pi)):
        total += pi[k] * gaussian_pdf(X, means[k], covs[k])
    total = np.clip(total, 1e-300, None)
    return np.sum(np.log(total))
def kmeans(X, K, max_iter=100, random_state=0):
    """K-means cài đặt thủ công """
    rng = np.random.default_rng(random_state)
    centers = X[rng.choice(X.shape[0], size=K, replace=False)].copy()
    labels = np.zeros(X.shape[0], dtype=int)
    for _ in range(max_iter):
        distances = ((X[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new_labels = distances.argmin(axis=1)
        if np.all(new_labels == labels):
            break
        labels = new_labels
        new_centers = np.empty_like(centers)
        for k in range(K):
            if np.any(labels == k):
                new_centers[k] = X[labels == k].mean(axis=0)
            else:
                new_centers[k] = centers[k]
        centers = new_centers

    return labels, centers

def initialize_gmm_from_kmeans(X, K, random_state=0):
    """Khởi tạo tham số GMM (pi, means, covs) bằng kết quả phân cụm K-means."""
    labels_init, centers_init = kmeans(X, K=K, random_state=random_state)
    N, D = X.shape

    pi0 = np.array([np.mean(labels_init == k) for k in range(K)])
    means0 = centers_init.copy()

    covs0 = np.zeros((K, D, D))
    for k in range(K):
        pts = X[labels_init == k]
        if len(pts) > 1:
            covs0[k] = np.cov(pts.T) + 1e-6 * np.eye(D)
        else:
            covs0[k] = np.cov(X.T) + 1e-6 * np.eye(D)

    return pi0, means0, covs0
def gmm_em_from_init(X, pi0, means0, covs0, max_iter=EM_MAX_ITER, tol=EM_TOL):
    """Chạy thuật toán EM cho GMM, xuất phát từ tham số khởi tạo bằng K-means."""
    pi, means, covs = pi0.copy(), means0.copy(), covs0.copy()
    ll_history = []
    prev_ll = -np.inf

    for it in range(1, max_iter + 1):
        R = e_step(X, pi, means, covs)
        pi, means, covs = m_step(X, R)
        ll = log_likelihood(X, pi, means, covs)
        ll_history.append(ll)
        if abs(ll - prev_ll) < tol:
            break
        prev_ll = ll

    return pi, means, covs, R, ll_history
# 3. ĐỌC & TIỀN XỬ LÝ DỮ LIỆU QUICKDRAW
def load_category_sequences(category, data_dir, limit):
    """Đọc file .ndjson raw của 1 category, trả về list các chuỗi điểm (T,2)."""
    filename = category.replace(" ", "_") + ".ndjson"
    path = os.path.join(data_dir, filename)
    sequences = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if len(sequences) >= limit:
                break
            obj = json.loads(line)
            if not obj.get("recognized", True):
                continue  # bỏ các bản vẽ bị người chơi vẽ sai/không rõ
            points = []
            for stroke in obj["drawing"]:
                xs, ys = stroke[0], stroke[1]
                points.extend(zip(xs, ys))

            if len(points) < MIN_POINTS_PER_SEQUENCE:
                continue
            sequences.append(np.array(points, dtype=float))
    return sequences
def normalize_sequence(points):
    """Chuẩn hoá 1 chuỗi điểm: trừ mean, chia std (đúng như bài báo mô tả)."""
    mean = points.mean(axis=0)
    std = points.std(axis=0)
    std = np.where(std < 1e-6, 1e-6, std)
    return (points - mean) / std
def segment_sequence(points, n_states):
    """Chia chuỗi điểm (đã chuẩn hoá) thành n_states phần liên tiếp theo đúng
    thứ tự vẽ - đây chính là cách khởi tạo trạng thái mà bài báo đề xuất cho
    forward-only HMM (vd: circle chia thành 4 phần = 4 quadrant)."""
    T = len(points)
    boundaries = np.linspace(0, T, n_states + 1).astype(int)
    segments = []
    for i in range(n_states):
        seg = points[boundaries[i]:boundaries[i + 1]]
        if len(seg) == 0:
            idx = min(boundaries[i], T - 1)
            seg = points[idx:idx + 1]
        segments.append(seg)
    return segments
def train_test_split(sequences, test_ratio, random_state):
    rng = np.random.default_rng(random_state)
    idx = rng.permutation(len(sequences))
    n_test = max(1, int(len(sequences) * test_ratio))
    test_idx, train_idx = idx[:n_test], idx[n_test:]
    return [sequences[i] for i in train_idx], [sequences[i] for i in test_idx]


# 4. HMM FORWARD-ONLY (BAKIS MODEL) VỚI EMISSION LÀ GMM
def gmm_state_log_prob(x, gmm):
    """log p(x | trạng thái) với emission là GMM nhiều component."""
    total = 0.0
    for k in range(len(gmm["pi"])):
        total += gmm["pi"][k] * gaussian_pdf(x, gmm["means"][k], gmm["covs"][k])
    total = max(total, 1e-300)
    return np.log(total)
def forward_log_likelihood(points, model):
    """Thuật toán forward (log-domain) tính P(O|lambda) cho HMM forward-only.

    - P (initial): luôn bắt đầu ở trạng thái 0 -> log_alpha[0] khởi tạo trực tiếp.
    - A (transition): chỉ có 2 khả năng từ trạng thái j: ở lại j (self_prob)
      hoặc sang j+1 (next_prob); không có đường quay lại.
    """
    n_states = model["n_states"]
    log_self = np.log(model["self_prob"])
    log_next = np.log(model["next_prob"])
    gmms = model["gmms"]
    log_alpha = np.full(n_states, -np.inf)
    log_alpha[0] = gmm_state_log_prob(points[0], gmms[0])  # log(P[0]=1) = 0
    for t in range(1, len(points)):
        new_log_alpha = np.full(n_states, -np.inf)
        for j in range(n_states):
            terms = []
            if log_alpha[j] > -np.inf:
                terms.append(log_alpha[j] + log_self)
            if j > 0 and log_alpha[j - 1] > -np.inf:
                terms.append(log_alpha[j - 1] + log_next)
            if terms:
                b_j = gmm_state_log_prob(points[t], gmms[j])
                new_log_alpha[j] = logsumexp(terms) + b_j
        log_alpha = new_log_alpha
        if np.all(np.isneginf(log_alpha)):
            break
    return logsumexp(log_alpha)
def train_class_model(category, train_sequences, n_states, n_mix,
                       self_prob, random_state):
    """Huấn luyện 1 HMM-GMM forward-only cho 1 lớp cử chỉ.

    Bước khởi tạo: chuẩn hoá từng mẫu vẽ, chia đều thành n_states
    phần theo thứ tự vẽ, dồn toàn bộ điểm cùng vị trí trạng thái của mọi mẫu
    trong lớp lại -> huấn luyện 1 GMM (kmeans-init + EM) riêng cho trạng thái đó.
    """
    state_points = [[] for _ in range(n_states)]
    for seq in train_sequences:
        norm = normalize_sequence(seq)
        segments = segment_sequence(norm, n_states)
        for s, seg in enumerate(segments):
            state_points[s].extend(seg.tolist())
    gmms, ll_histories = [], []
    for s in range(n_states):
        X_s = np.array(state_points[s])
        if len(X_s) < 2:
            X_s = np.vstack([X_s, X_s + 1e-3]) if len(X_s) == 1 else \
                  np.random.default_rng(random_state).normal(size=(4, 2))
        k = max(1, min(n_mix, len(X_s) // 3))
        pi0, means0, covs0 = initialize_gmm_from_kmeans(X_s, K=k, random_state=random_state)
        pi_f, means_f, covs_f, _, ll_hist = gmm_em_from_init(X_s, pi0, means0, covs0)

        gmms.append({"pi": pi_f, "means": means_f, "covs": covs_f})
        ll_histories.append(ll_hist)
    return {
        "category": category,
        "n_states": n_states,
        "self_prob": self_prob,
        "next_prob": 1.0 - self_prob,
        "gmms": gmms,
        "ll_histories": ll_histories,
        "state_points": state_points,  # giữ lại để vẽ minh hoạ
    }

def predict(points, models):
    """Phân loại 1 chuỗi điểm: chọn model có log-likelihood cao nhất."""
    norm = normalize_sequence(points)
    scores = {cat: forward_log_likelihood(norm, m) for cat, m in models.items()}
    best_cat = max(scores, key=scores.get)
    return best_cat, scores
# 4b. XUẤT / NẠP MODEL SAU KHI HUẤN LUYỆN
def save_models(models, path):
    """Lưu toàn bộ model (1 HMM-GMM / lớp) ra file .pkl để dùng lại cho việc
    inference sau này (vd nạp vào app "Draw something!") mà không cần train lại.

    Chỉ lưu phần tham số cần cho việc suy luận (n_states, self_prob, next_prob,
    gmms) - bỏ "state_points" và "ll_histories" (chỉ dùng để vẽ plot, không cần
    cho lúc predict) để file gọn hơn.
    """
    export = {}
    for cat, model in models.items():
        export[cat] = {
            "category": model["category"],
            "n_states": model["n_states"],
            "self_prob": model["self_prob"],
            "next_prob": model["next_prob"],
            "gmms": model["gmms"],
        }

    with open(path, "wb") as f:
        pickle.dump({"categories": list(models.keys()), "models": export}, f)

    size_kb = os.path.getsize(path) / 1024
    print(f"[LƯU MODEL] {path} ({size_kb:.1f} KB)")
def load_models(path):
    """Nạp lại model đã lưu bằng save_models(). Trả về dict {category: model}
    dùng trực tiếp được với hàm predict()."""
    with open(path, "rb") as f:
        data = pickle.load(f)
    return data["models"]
# 5. VẼ KẾT QUẢ HUẤN LUYỆN
def plot_em_convergence(models, output_dir):
    """Vẽ đường cong hội tụ log-likelihood của EM cho từng trạng thái, mỗi lớp
    1 subplot - minh hoạ hiệu quả của việc khởi tạo bằng K-means."""
    n_cat = len(models)
    fig, axes = plt.subplots(1, n_cat, figsize=(4.2 * n_cat, 4), squeeze=False)
    axes = axes[0]

    for ax, (cat, model) in zip(axes, models.items()):
        for s, ll_hist in enumerate(model["ll_histories"]):
            ax.plot(range(1, len(ll_hist) + 1), ll_hist, marker='o',
                    markersize=3, linewidth=1.5, label=f"state {s}")
        ax.set_title(f"'{cat}' - EM convergence")
        ax.set_xlabel("Iteration")
        ax.set_ylabel("Log-likelihood")
        ax.legend(fontsize=8)
        ax.grid(alpha=0.3)

    plt.tight_layout()
    path = os.path.join(output_dir, "01_em_convergence.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[LƯU] {path}")


def plot_state_gaussians(model, output_dir):
    """Vẽ các điểm đã gán theo trạng thái + contour Gaussian đã học được,
    cho 1 lớp cử chỉ minh hoạ (giống style contour trong notebook gốc)."""
    n_states = model["n_states"]
    colors = plt.cm.tab10(np.linspace(0, 1, n_states))

    all_points = np.vstack(model["state_points"])
    min_x, max_x = all_points[:, 0].min() - 1, all_points[:, 0].max() + 1
    min_y, max_y = all_points[:, 1].min() - 1, all_points[:, 1].max() + 1
    xx, yy = np.meshgrid(np.linspace(min_x, max_x, 120), np.linspace(min_y, max_y, 120))
    grid = np.column_stack([xx.ravel(), yy.ravel()])

    fig, ax = plt.subplots(figsize=(7, 6))
    for s in range(n_states):
        pts = np.array(model["state_points"][s])
        ax.scatter(pts[:, 0], pts[:, 1], s=10, alpha=0.4, color=colors[s],
                   label=f"state {s}")
        gmm = model["gmms"][s]
        for k in range(len(gmm["pi"])):
            Z = gaussian_pdf(grid, gmm["means"][k], gmm["covs"][k]).reshape(xx.shape)
            ax.contour(xx, yy, Z, levels=5, colors=[colors[s]], alpha=0.8)

    ax.set_title(f"GMM đã học theo từng trạng thái - lớp '{model['category']}'")
    ax.set_xlabel("x (đã chuẩn hoá)")
    ax.set_ylabel("y (đã chuẩn hoá)")
    ax.legend(fontsize=8)
    plt.tight_layout()
    path = os.path.join(output_dir, f"02_state_gaussians_{model['category']}.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[LƯU] {path}")


def plot_confusion_matrix(y_true, y_pred, categories, output_dir):
    n = len(categories)
    idx = {c: i for i, c in enumerate(categories)}
    cm = np.zeros((n, n), dtype=int)
    for t, p in zip(y_true, y_pred):
        cm[idx[t], idx[p]] += 1

    fig, ax = plt.subplots(figsize=(1.4 * n + 2, 1.4 * n + 2))
    im = ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(n)); ax.set_xticklabels(categories, rotation=45, ha="right")
    ax.set_yticks(range(n)); ax.set_yticklabels(categories)
    ax.set_xlabel("Dự đoán"); ax.set_ylabel("Thực tế")
    ax.set_title("Confusion matrix - tập test")

    for i in range(n):
        for j in range(n):
            ax.text(j, i, cm[i, j], ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "black")

    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    plt.tight_layout()
    path = os.path.join(output_dir, "03_confusion_matrix.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[LƯU] {path}")
    return cm


def plot_accuracy_bar(y_true, y_pred, categories, output_dir):
    accs = []
    for cat in categories:
        idxs = [i for i, t in enumerate(y_true) if t == cat]
        correct = sum(1 for i in idxs if y_pred[i] == cat)
        accs.append(correct / len(idxs) if idxs else 0.0)

    overall = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true)

    fig, ax = plt.subplots(figsize=(1.4 * len(categories) + 2, 4.5))
    bars = ax.bar(categories, accs, color="tab:blue", alpha=0.8)
    ax.axhline(overall, color="red", linestyle="--", label=f"Trung bình = {overall:.2%}")
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Accuracy")
    ax.set_title("Accuracy theo từng lớp trên tập test")
    ax.legend()
    for b, a in zip(bars, accs):
        ax.text(b.get_x() + b.get_width() / 2, a + 0.02, f"{a:.0%}", ha="center")

    plt.tight_layout()
    path = os.path.join(output_dir, "04_accuracy_per_class.png")
    plt.savefig(path, dpi=150)
    plt.close(fig)
    print(f"[LƯU] {path}")
    return overall
# 6. MAIN PIPELINE
def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("=" * 70)
    print("BƯỚC 1: Đọc dữ liệu QuickDraw")
    print("=" * 70)
    train_data, test_data = {}, {}
    for cat in CATEGORIES:
        seqs = load_category_sequences(cat, DATA_DIR, SAMPLES_PER_CLASS)
        train_seqs, test_seqs = train_test_split(seqs, TEST_RATIO, RANDOM_STATE)
        train_data[cat], test_data[cat] = train_seqs, test_seqs
        print(f"  {cat:12s}: {len(train_seqs)} mẫu train, {len(test_seqs)} mẫu test")

    print("\n" + "=" * 70)
    print("BƯỚC 2: Huấn luyện HMM-GMM (forward-only) cho từng lớp")
    print("=" * 70)
    models = {}
    for cat in CATEGORIES:
        print(f"  Đang huấn luyện '{cat}' ...")
        model = train_class_model(cat, train_data[cat], N_STATES, N_MIX,
                                   SELF_LOOP_PROB, RANDOM_STATE)
        models[cat] = model
        total_iters = sum(len(h) for h in model["ll_histories"])
        print(f"    -> Tổng số vòng lặp EM qua {N_STATES} trạng thái: {total_iters}")

    save_models(models, MODEL_PATH)

    print("\n" + "=" * 70)
    print("BƯỚC 3: Đánh giá trên tập test")
    print("=" * 70)
    y_true, y_pred = [], []
    for cat in CATEGORIES:
        for seq in test_data[cat]:
            pred_cat, _ = predict(seq, models)
            y_true.append(cat)
            y_pred.append(pred_cat)

    overall_acc = sum(t == p for t, p in zip(y_true, y_pred)) / len(y_true)
    print(f"  Accuracy tổng thể trên tập test: {overall_acc:.2%}")

    print("\n" + "=" * 70)
    print("BƯỚC 4: Xuất plot kết quả huấn luyện")
    print("=" * 70)
    plot_em_convergence(models, OUTPUT_DIR)
    plot_state_gaussians(models[CATEGORIES[0]], OUTPUT_DIR)  # minh hoạ lớp đầu tiên
    plot_confusion_matrix(y_true, y_pred, CATEGORIES, OUTPUT_DIR)
    plot_accuracy_bar(y_true, y_pred, CATEGORIES, OUTPUT_DIR)
    print(f"\nHoàn tất. Model đã lưu tại: {MODEL_PATH}")
    print(f"Toàn bộ plot đã lưu tại: {OUTPUT_DIR}")
if __name__ == "__main__":
    main()
