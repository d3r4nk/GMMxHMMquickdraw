const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");

const clearAllBtn = document.getElementById("clearAllBtn");
const deleteLastBtn = document.getElementById("deleteLastBtn");
const undoBtn = document.getElementById("undoBtn");
const okBtn = document.getElementById("okBtn");
const drawPanel = document.getElementById("drawPanel");
const cameraPanel = document.getElementById("cameraPanel");
const cameraPreview = document.getElementById("cameraPreview");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const modeButtons = document.querySelectorAll(".mode-btn");
const statusElement = document.getElementById("status");


// ========================================
// DATA
// ========================================

let currentMode = "draw";
let cameraStream = null;

// Danh sách các nét vẽ hiện tại
let strokes = [];

// Các nét vừa bị xóa
// Dùng cho chức năng Undo
let deletedStrokes = [];


// Nét hiện tại đang được vẽ
let currentStroke = null;

// Trạng thái chuột
let isDrawing = false;


// ========================================
// CANVAS
// ========================================

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();

    const oldImage = canvas.toDataURL();

    canvas.width = rect.width;
    canvas.height = rect.height;

    redraw();
}

window.addEventListener("resize", resizeCanvas);


// ========================================
// VẼ LẠI TOÀN BỘ CANVAS
// ========================================

function redraw() {
    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );

    for (const stroke of strokes) {

        if (stroke.points.length < 2) {
            continue;
        }

        ctx.beginPath();

        ctx.moveTo(
            stroke.points[0].x,
            stroke.points[0].y
        );

        for (let i = 1; i < stroke.points.length; i++) {

            ctx.lineTo(
                stroke.points[i].x,
                stroke.points[i].y
            );
        }

        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.stroke();
    }
}


// ========================================
// LẤY TỌA ĐỘ CHUỘT TRÊN CANVAS
// ========================================

function getMousePosition(event) {

    const rect = canvas.getBoundingClientRect();

    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
    };
}


// ========================================
// BẮT ĐẦU VẼ
// ========================================

canvas.addEventListener("mousedown", function(event) {

    if (currentMode !== "draw") {
        return;
    }

    // Chỉ nhận chuột trái
    if (event.button !== 0) {
        return;
    }

    isDrawing = true;

    const position = getMousePosition(event);

    currentStroke = {
        id: Date.now(),

        color: "#000000",

        width: 4,

        points: [
            position
        ]
    };

    // Khi bắt đầu một nét mới,
    // xóa lịch sử redo
    deletedStrokes = [];

    ctx.beginPath();

    ctx.moveTo(
        position.x,
        position.y
    );

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.strokeStyle = currentStroke.color;
    ctx.lineWidth = currentStroke.width;
});


// ========================================
// ĐANG DI CHUYỂN CHUỘT -> VẼ
// ========================================

canvas.addEventListener("mousemove", function(event) {

    if (currentMode !== "draw") {
        return;
    }

    if (!isDrawing || !currentStroke) {
        return;
    }

    const position = getMousePosition(event);

    currentStroke.points.push(position);

    ctx.lineTo(
        position.x,
        position.y
    );

    ctx.stroke();
});


// ========================================
// KẾT THÚC NÉT VẼ
// ========================================

function finishDrawing() {

    if (currentMode !== "draw") {
        return;
    }

    if (!isDrawing || !currentStroke) {
        return;
    }

    isDrawing = false;

    // Chỉ lưu nét nếu có điểm
    if (currentStroke.points.length > 0) {

        strokes.push(currentStroke);
    }

    currentStroke = null;

    updateButtons();
}

canvas.addEventListener(
    "mouseup",
    finishDrawing
);

canvas.addEventListener(
    "mouseleave",
    finishDrawing
);


// ========================================
// XÓA TẤT CẢ
// ========================================

clearAllBtn.addEventListener("click", function() {

    if (strokes.length === 0) {
        return;
    }

    // Lưu toàn bộ nét để có thể Undo
    deletedStrokes.push({
        type: "clear",
        strokes: [...strokes]
    });

    strokes = [];

    redraw();

    updateButtons();

    showStatus("Đã xóa tất cả nét vẽ.");
});


// ========================================
// XÓA NÉT GẦN NHẤT
// ========================================

function deleteLastStroke() {

    if (strokes.length === 0) {
        return;
    }

    const deletedStroke = strokes.pop();

    deletedStrokes.push({
        type: "stroke",
        stroke: deletedStroke
    });

    redraw();

    updateButtons();

    showStatus("Đã xóa nét vẽ gần nhất.");
}

deleteLastBtn.addEventListener("click", deleteLastStroke);


// ========================================
// UNDO NÉT VỪA XÓA
// ========================================

function undoLastDeletedStroke() {

    if (deletedStrokes.length === 0) {
        return;
    }

    const action = deletedStrokes.pop();

    if (action.type === "stroke") {

        strokes.push(action.stroke);
    }

    else if (action.type === "clear") {

        strokes = action.strokes;
    }

    redraw();

    updateButtons();

    showStatus("Đã khôi phục nét vẽ.");
}

undoBtn.addEventListener("click", undoLastDeletedStroke);


document.addEventListener("keydown", function(event) {

    if (!event.ctrlKey) {
        return;
    }

    const key = event.key.toLowerCase();

    if (key === "z") {
        event.preventDefault();
        deleteLastStroke();
    }

    else if (key === "y") {
        event.preventDefault();
        undoLastDeletedStroke();
    }
});


// ========================================
// CHUYỂN CHẾ ĐỘ
// ========================================

function updateModeButtons() {

    modeButtons.forEach(function(button) {

        const isActive = button.dataset.mode === currentMode;

        button.classList.toggle("active", isActive);
        button.setAttribute("aria-pressed", String(isActive));
    });
}

function updateModePanels() {

    const isDrawMode = currentMode === "draw";

    if (drawPanel) {
        drawPanel.classList.toggle("active", isDrawMode);
    }

    if (cameraPanel) {
        cameraPanel.classList.toggle("active", !isDrawMode);
    }

    if (cameraPreview) {
        cameraPreview.style.display = cameraStream ? "block" : "none";
    }

    if (cameraPlaceholder) {
        cameraPlaceholder.style.display = cameraStream ? "none" : "flex";
    }
}

function stopCameraStream() {

    if (cameraStream) {
        cameraStream.getTracks().forEach(function(track) {
            track.stop();
        });

        cameraStream = null;
    }

    if (cameraPreview) {
        cameraPreview.srcObject = null;
    }
}

function enableCameraMode() {

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showStatus("Trình duyệt không hỗ trợ camera.");
        return;
    }

    navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
    })
    .then(function(stream) {
        cameraStream = stream;

        if (cameraPreview) {
            cameraPreview.srcObject = stream;
            cameraPreview.play();
        }

        currentMode = "camera";
        updateModeButtons();
        updateModePanels();

        showStatus("Đã chuyển sang chế độ camera.");
    })
    .catch(function() {
        currentMode = "draw";
        updateModeButtons();
        updateModePanels();

        showStatus("Bạn đã từ chối quyền truy cập camera.");
    });
}

function setDrawMode() {

    currentMode = "draw";
    stopCameraStream();
    updateModeButtons();
    updateModePanels();

    showStatus("Đã quay lại chế độ bảng vẽ.");
}

modeButtons.forEach(function(button) {

    button.addEventListener("click", function() {

        if (button.dataset.mode === "camera") {
            if (currentMode === "camera") {
                return;
            }

            currentMode = "camera";
            updateModeButtons();
            updateModePanels();
            enableCameraMode();
            return;
        }

        if (currentMode === "draw") {
            return;
        }

        setDrawMode();
    });
});


// ========================================
// NÚT OK
// ========================================

okBtn.addEventListener("click", function() {

    if (strokes.length === 0) {

        showStatus("Chưa có nét vẽ.");

        return;
    }

    okBtn.disabled = true;
    showStatus("Đang nhận diện...");

    fetch("/recognize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            strokes: strokes
        })
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {

        okBtn.disabled = false;

        if (!result.ok) {
            showStatus("Lỗi: " + (result.data.error || "không nhận diện được."));
            return;
        }

        showStatus(
            "Kết quả: " + result.data.category +
            " (" + result.data.confidence + "%)"
        );
    })
    .catch(function(error) {
        okBtn.disabled = false;
        showStatus("Lỗi kết nối tới server.");
        console.error(error);
    });
});


// ========================================
// BUTTON STATE
// ========================================

function updateButtons() {

    deleteLastBtn.disabled =
        strokes.length === 0;

    undoBtn.disabled =
        deletedStrokes.length === 0;
}


// ========================================
// HIỂN THỊ THÔNG BÁO
// ========================================

function showStatus(message) {

    statusElement.textContent = message;
}


// ========================================
// KHỞI TẠO
// ========================================

resizeCanvas();

currentMode = "draw";
updateModeButtons();
updateModePanels();
updateButtons();