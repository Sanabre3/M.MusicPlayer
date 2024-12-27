const playButton = document.getElementById("play");
const disk = document.querySelector(".disk .cover");
const fillBar = document.querySelector(".fill-bar");
const progressBar = document.querySelector(".progress-bar");

let isPlaying = false;
let currentTime = 0;
const duration = 180;
let progressInterval;

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function updateProgress() {
    if (isPlaying) {
        currentTime += 1;
        if (currentTime >= duration) {
            currentTime = duration;
            clearInterval(progressInterval);
            isPlaying = false;
            togglePlayPause();
        }

        const progressPercent = (currentTime / duration) * 100;
        fillBar.style.width = `${progressPercent}%`;
    }
}

function togglePlayPause() {
    isPlaying = !isPlaying;

    if (isPlaying) {
        playButton.innerHTML = '<i class="fas fa-pause"></i>';
        disk.classList.add("active");
        progressInterval = setInterval(updateProgress, 1000);
    } else {
        playButton.innerHTML = '<i class="fas fa-play"></i>';
        disk.classList.remove("active");
        clearInterval(progressInterval);
    }
}

progressBar.addEventListener("click", (event) => {
    const progressBarWidth = progressBar.offsetWidth;
    const clickX = event.offsetX;
    const newTime = Math.floor((clickX / progressBarWidth) * duration);
    currentTime = Math.min(newTime, duration);

    const progressPercent = (currentTime / duration) * 100;
    fillBar.style.width = `${progressPercent}%`;
});

playButton.addEventListener("click", togglePlayPause);
