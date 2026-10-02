const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");

const clearAllBtn = document.getElementById("clearAllBtn");
const deleteLastBtn = document.getElementById("deleteLastBtn");
const undoBtn = document.getElementById("undoBtn");
const okBtn = document.getElementById("okBtn");
const drawPanel = document.getElementById("drawPanel");
const cameraPanel = document.getElementById("cameraPanel");
const cameraPreview = document.getElementById("cameraPreview");
const cameraCanvas = document.getElementById("cameraCanvas");
const cameraCtx = cameraCanvas.getContext("2d");
const cameraCursor = document.getElementById("cameraCursor");
const cameraPlaceholder = document.getElementById("cameraPlaceholder");
const modeButtons = document.querySelectorAll(".mode-btn");
const statusElement = document.getElementById("status");


// ========================================
// DATA
// ========================================

let currentMode = "draw";
let cameraStream = null;
let handLandmarker = null;
let trackingAnimationId = null;
let lastVideoTime = -1;
let activeGesture = "";
let gestureCandidate = "";
let gestureCandidateSince = 0;
let isRecognizing = false;
const GESTURE_HOLD_DURATION_MS = 500;

// Danh sách các nét vẽ hiện tại
let strokes = [];

// Các nét vừa bị xóa
// Dùng cho chức năng Undo
let deletedStrokes = [];

let cameraStrokes = [];
let cameraCurrentStroke = null;


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
    resizeCameraCanvas();
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

function resizeCameraCanvas() {
    const rect = cameraCanvas.getBoundingClientRect();

    if (!rect.width || !rect.height) {
        return;
    }

    cameraCanvas.width = rect.width;
    cameraCanvas.height = rect.height;

    for (const stroke of cameraStrokes) {
        if (stroke.points.length < 2) {
            continue;
        }

        cameraCtx.beginPath();
        cameraCtx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
            cameraCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }

        cameraCtx.strokeStyle = stroke.color;
        cameraCtx.lineWidth = stroke.width;
        cameraCtx.lineCap = "round";
        cameraCtx.lineJoin = "round";
        cameraCtx.stroke();
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

    if (cameraCanvas) {
        cameraCanvas.style.display = cameraStream ? "block" : "none";
    }

    if (cameraPlaceholder) {
        cameraPlaceholder.style.display = cameraStream ? "none" : "flex";
    }
}

function stopCameraStream() {

    stopHandTracking();

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

async function initializeHandLandmarker() {
    if (handLandmarker) {
        return;
    }

    showStatus("Đang tải nhận diện bàn tay...");

    const visionModule = await import(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
    );
    const vision = await visionModule.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    handLandmarker = await visionModule.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5
    });
}

function enableCameraMode() {

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showStatus("Trình duyệt không hỗ trợ camera.");
        return;
    }

    navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
    })
    .then(async function(stream) {
        if (currentMode !== "camera") {
            stream.getTracks().forEach(function(track) {
                track.stop();
            });
            return;
        }

        cameraStream = stream;

        if (cameraPreview) {
            cameraPreview.srcObject = stream;
            await cameraPreview.play();
        }

        currentMode = "camera";
        updateModeButtons();
        updateModePanels();
        resizeCameraCanvas();

        try {
            await initializeHandLandmarker();
            startHandTracking();
            showStatus("Camera đã sẵn sàng.");
        } catch (error) {
            showStatus("Không tải được MediaPipe. Kiểm tra kết nối Internet.");
            console.error(error);
        }
    })
    .catch(function() {
        currentMode = "draw";
        updateModeButtons();
        updateModePanels();

        showStatus("Bạn đã từ chối quyền truy cập camera.");
    });
}

function stopHandTracking() {
    if (trackingAnimationId !== null) {
        cancelAnimationFrame(trackingAnimationId);
        trackingAnimationId = null;
    }

    cameraCurrentStroke = null;
    activeGesture = "";
    gestureCandidate = "";
    gestureCandidateSince = 0;
    lastVideoTime = -1;

    if (cameraCursor) {
        cameraCursor.style.display = "none";
    }
}

function startHandTracking() {
    if (trackingAnimationId !== null) {
        return;
    }

    function trackFrame() {
        if (currentMode !== "camera" || !cameraStream || !handLandmarker) {
            trackingAnimationId = null;
            return;
        }

        if (cameraPreview.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            cameraPreview.currentTime !== lastVideoTime) {
            lastVideoTime = cameraPreview.currentTime;
            const result = handLandmarker.detectForVideo(cameraPreview, performance.now());
            const landmarks = result.landmarks[0];

            if (landmarks) {
                processHandLandmarks(landmarks);
            } else {
                cameraCurrentStroke = null;
                activeGesture = "";
                gestureCandidate = "";
                gestureCandidateSince = 0;
                cameraCursor.style.display = "none";
            }
        }

        trackingAnimationId = requestAnimationFrame(trackFrame);
    }

    trackingAnimationId = requestAnimationFrame(trackFrame);
}

function distanceBetween(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

function classifyHandGesture(landmarks) {
    const indexExtended = landmarks[8].y < landmarks[6].y;
    const middleExtended = landmarks[12].y < landmarks[10].y;
    const ringExtended = landmarks[16].y < landmarks[14].y;
    const pinkyExtended = landmarks[20].y < landmarks[18].y;
    const thumbIndexPinched = distanceBetween(landmarks[4], landmarks[8]) <
        distanceBetween(landmarks[0], landmarks[9]) * 0.45;

    if (thumbIndexPinched && middleExtended && ringExtended && pinkyExtended) {
        return "recognize";
    }

    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
        return "draw";
    }

    if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
        return "clear";
    }

    return "none";
}

function getCameraPoint(landmark) {
    const rect = cameraCanvas.getBoundingClientRect();
    const videoWidth = cameraPreview.videoWidth;
    const videoHeight = cameraPreview.videoHeight;
    const scale = Math.max(rect.width / videoWidth, rect.height / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const cropLeft = (renderedWidth - rect.width) / 2;
    const cropTop = (renderedHeight - rect.height) / 2;

    return {
        x: videoWidth * (1 - landmark.x) * scale - cropLeft,
        y: videoHeight * landmark.y * scale - cropTop
    };
}

function beginCameraStroke(point) {
    cameraCurrentStroke = {
        id: Date.now(),
        color: "#000000",
        width: 4,
        points: [point]
    };
    cameraStrokes.push(cameraCurrentStroke);
    cameraCtx.beginPath();
    cameraCtx.moveTo(point.x, point.y);
    cameraCtx.strokeStyle = cameraCurrentStroke.color;
    cameraCtx.lineWidth = cameraCurrentStroke.width;
    cameraCtx.lineCap = "round";
    cameraCtx.lineJoin = "round";
}

function addCameraStrokePoint(point) {
    if (!cameraCurrentStroke) {
        beginCameraStroke(point);
        return;
    }

    cameraCurrentStroke.points.push(point);
    cameraCtx.lineTo(point.x, point.y);
    cameraCtx.stroke();
}

function clearCameraBoard() {
    cameraStrokes = [];
    cameraCurrentStroke = null;
    cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
}

function processHandLandmarks(landmarks) {
    const gesture = classifyHandGesture(landmarks);
    const point = getCameraPoint(landmarks[8]);
    const now = performance.now();

    cameraCursor.style.left = point.x + "px";
    cameraCursor.style.top = point.y + "px";
    cameraCursor.style.display = "block";

    if (gesture !== gestureCandidate) {
        gestureCandidate = gesture;
        gestureCandidateSince = now;
        cameraCurrentStroke = null;
    }

    if (gesture === "none") {
        cameraCurrentStroke = null;
        activeGesture = "";
        return;
    }

    if (now - gestureCandidateSince < GESTURE_HOLD_DURATION_MS) {
        return;
    }

    if (gesture === "draw") {
        addCameraStrokePoint(point);
    } else {
        cameraCurrentStroke = null;
    }

    if (gesture === "clear" && activeGesture !== "clear") {
        clearCameraBoard();
        showStatus("Đã xóa tất cả nét vẽ bằng camera.");
    } else if (gesture === "recognize" && activeGesture !== "recognize") {
        recognizeStrokes(cameraStrokes);
    }

    activeGesture = gesture;
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
    recognizeStrokes(strokes);
});

function recognizeStrokes(drawingStrokes) {
    if (drawingStrokes.length === 0) {

        showStatus("Chưa có nét vẽ.");

        return;
    }

    if (isRecognizing) {
        return;
    }

    isRecognizing = true;
    okBtn.disabled = true;
    showStatus("Đang nhận diện...");

    fetch("/recognize", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            strokes: drawingStrokes
        })
    })
    .then(function(response) {
        return response.json().then(function(data) {
            return { ok: response.ok, data: data };
        });
    })
    .then(function(result) {

        isRecognizing = false;
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
        isRecognizing = false;
        okBtn.disabled = false;
        showStatus("Lỗi kết nối tới server.");
        console.error(error);
    });
}


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