// Configuration
const GOOGLE_SHEETS_CONFIG = {
  webAppUrl:
    "https://script.google.com/macros/s/AKfycbzoljLJ5rgeCNaTk_514g3sws58UhNQBs4t7H1O2DDeXEt8AHRPNz_gCFQYuXtsQwun/exec",
  enableLogging: true,
};

// DOM Elements
const registerBtn = document.getElementById("registerBtn");
const loginBtn = document.getElementById("loginBtn");
const refreshUsersBtn = document.getElementById("refreshUsersBtn");
const userName = document.getElementById("userName");
const loginResult = document.getElementById("loginResult");
const usersList = document.getElementById("usersList");
const status = document.getElementById("status");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalMessage = document.getElementById("modalMessage");
const closeModal = document.querySelector(".close");

// Utility Functions
function showStatus(message, type = "info") {
  status.textContent = message;
  status.className = `status ${type}`;
  setTimeout(() => {
    status.textContent = "";
    status.className = "status";
  }, 5000);
}

function showModal(title, message) {
  modalTitle.textContent = title;
  modalMessage.textContent = message;
  modal.style.display = "block";
}

function hideModal() {
  modal.style.display = "none";
}

closeModal.onclick = hideModal;
window.onclick = (event) => {
  if (event.target === modal) {
    hideModal();
  }
};

function log(message, data = null) {
  if (GOOGLE_SHEETS_CONFIG.enableLogging) {
    console.log(`[Attendance System] ${message}`, data || "");
  }
}

// Check WebAuthn Support
function checkWebAuthnSupport() {
  if (!window.PublicKeyCredential) {
    showModal(
      "Browser Not Supported",
      "Your browser doesn't support fingerprint authentication. Please use a modern browser like Chrome, Edge, or Safari."
    );
    registerBtn.disabled = true;
    loginBtn.disabled = true;
    return false;
  }
  return true;
}

// Convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// Convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Get current date, day, and time
function getCurrentDateTime() {
  const now = new Date();
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const date = now.toLocaleDateString("en-US");
  const day = days[now.getDay()];
  const time = now.toLocaleTimeString("en-US");
  return { date, day, time, timestamp: now.toISOString() };
}

// Google Sheets API Functions
async function sendToGoogleSheets(action, data) {
  try {
    log(`Sending to Google Sheets: ${action}`, data);
    const response = await fetch(GOOGLE_SHEETS_CONFIG.webAppUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: action,
        data: data,
      }),
    });

    log(`Response received for ${action}`);
    return { success: true };
  } catch (error) {
    log(`Error sending to Google Sheets: ${error.message}`, error);
    throw error;
  }
}

// Register User
async function registerUser() {
  const name = userName.value.trim();
  if (!name) {
    showStatus("Please enter your name", "error");
    return;
  }

  try {
    registerBtn.disabled = true;
    showStatus("Preparing fingerprint registration...", "info");

    // Create credential
    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const publicKeyCredentialCreationOptions = {
      challenge: challenge,
      rp: {
        name: "Attendance System",
        id: window.location.hostname,
      },
      user: {
        id: new Uint8Array(16),
        name: name,
        displayName: name,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256
        { alg: -257, type: "public-key" }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
      },
      timeout: 60000,
      attestation: "none",
    };

    window.crypto.getRandomValues(publicKeyCredentialCreationOptions.user.id);

    showStatus("Please scan your fingerprint...", "info");

    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    });

    log("Credential created", credential);

    // Store credential locally
    const credentialId = arrayBufferToBase64(credential.rawId);
    const storedUsers = JSON.parse(localStorage.getItem("users") || "[]");
    
    // Check if user already exists
    if (storedUsers.some(u => u.name === name)) {
      showStatus("User already registered!", "error");
      registerBtn.disabled = false;
      return;
    }

    storedUsers.push({
      name: name,
      credentialId: credentialId,
      registeredAt: new Date().toISOString(),
    });
    localStorage.setItem("users", JSON.stringify(storedUsers));

    // Send to Google Sheets
    await sendToGoogleSheets("register", {
      name: name,
      credentialId: credentialId,
      registeredAt: new Date().toISOString(),
    });

    showStatus("Registration successful!", "success");
    userName.value = "";
    loadUsers();

    showModal(
      "Registration Successful!",
      `${name} has been successfully registered. You can now use your fingerprint to mark attendance.`
    );
  } catch (error) {
    log("Registration error", error);
    if (error.name === "NotAllowedError") {
      showStatus("Registration cancelled or fingerprint not recognized", "error");
    } else {
      showStatus(`Registration failed: ${error.message}`, "error");
    }
  } finally {
    registerBtn.disabled = false;
  }
}

// Login User
async function loginUser() {
  try {
    loginBtn.disabled = true;
    loginResult.textContent = "";
    loginResult.className = "result";
    showStatus("Preparing fingerprint scan...", "info");

    const storedUsers = JSON.parse(localStorage.getItem("users") || "[]");
    if (storedUsers.length === 0) {
      showStatus("No registered users found", "error");
      loginBtn.disabled = false;
      return;
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const allowCredentials = storedUsers.map((user) => ({
      type: "public-key",
      id: base64ToArrayBuffer(user.credentialId),
    }));

    const publicKeyCredentialRequestOptions = {
      challenge: challenge,
      allowCredentials: allowCredentials,
      timeout: 60000,
      userVerification: "required",
    };

    showStatus("Please scan your fingerprint...", "info");

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    });

    log("Assertion received", assertion);

    // Find matching user
    const credentialId = arrayBufferToBase64(assertion.rawId);
    const matchedUser = storedUsers.find((u) => u.credentialId === credentialId);

    if (matchedUser) {
      const dateTime = getCurrentDateTime();

      // Send attendance to Google Sheets
      await sendToGoogleSheets("attendance", {
        name: matchedUser.name,
        date: dateTime.date,
        day: dateTime.day,
        time: dateTime.time,
        timestamp: dateTime.timestamp,
      });

      showStatus("Attendance marked successfully!", "success");
      loginResult.textContent = `✓ Welcome ${matchedUser.name}! Attendance marked at ${dateTime.time} on ${dateTime.day}, ${dateTime.date}`;
      loginResult.className = "result success";

      showModal(
        "Attendance Marked!",
        `Welcome ${matchedUser.name}!\n\nDate: ${dateTime.date}\nDay: ${dateTime.day}\nTime: ${dateTime.time}\n\nYour attendance has been recorded successfully.`
      );
    } else {
      showStatus("User not found", "error");
      loginResult.textContent = "✗ Fingerprint not recognized";
      loginResult.className = "result error";
    }
  } catch (error) {
    log("Login error", error);
    if (error.name === "NotAllowedError") {
      showStatus("Login cancelled or fingerprint not recognized", "error");
      loginResult.textContent = "✗ Authentication cancelled";
    } else {
      showStatus(`Login failed: ${error.message}`, "error");
      loginResult.textContent = `✗ Error: ${error.message}`;
    }
    loginResult.className = "result error";
  } finally {
    loginBtn.disabled = false;
  }
}

// Load Users
function loadUsers() {
  const storedUsers = JSON.parse(localStorage.getItem("users") || "[]");

  if (storedUsers.length === 0) {
    usersList.innerHTML = '<p class="loading">No users registered yet</p>';
    return;
  }

  usersList.innerHTML = storedUsers
    .map(
      (user) => `
        <div class="user-item">
            <div class="user-info">
                <span class="user-icon">👤</span>
                <div>
                    <div class="user-name">${user.name}</div>
                    <small style="color: #999;">Registered: ${new Date(
                      user.registeredAt
                    ).toLocaleString()}</small>
                </div>
            </div>
            <button class="btn btn-danger" onclick="deleteUser('${user.credentialId}')">
                Delete
            </button>
        </div>
    `
    )
    .join("");
}

// Delete User
function deleteUser(credentialId) {
  if (confirm("Are you sure you want to delete this user?")) {
    let storedUsers = JSON.parse(localStorage.getItem("users") || "[]");
    const user = storedUsers.find((u) => u.credentialId === credentialId);
    
    storedUsers = storedUsers.filter((u) => u.credentialId !== credentialId);
    localStorage.setItem("users", JSON.stringify(storedUsers));

    // Optionally send deletion to Google Sheets
    sendToGoogleSheets("delete", {
      name: user.name,
      credentialId: credentialId,
    }).catch(err => log("Delete sync error", err));

    loadUsers();
    showStatus("User deleted successfully", "success");
  }
}

// Event Listeners
registerBtn.addEventListener("click", registerUser);
loginBtn.addEventListener("click", loginUser);
refreshUsersBtn.addEventListener("click", loadUsers);

// Initialize
window.addEventListener("DOMContentLoaded", () => {
  if (checkWebAuthnSupport()) {
    loadUsers();
    showStatus("System ready", "success");
  }
});