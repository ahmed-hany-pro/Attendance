import React, { useState, useEffect } from 'react';
import { User, Clock, Calendar, CheckCircle, UserPlus, LogIn, AlertCircle, Fingerprint } from 'lucide-react';

const GOOGLE_SHEETS_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/AKfycbzbbe5iB4YX-j8pZS6WjPlYkrhZz5Np1kpTb87bAoKBEvOAGIbYfNhXzQRRoRlKHdLp/exec",
  enableLogging: true,
};

// WebAuthn Helper Functions
const webAuthnSupported = () => {
  return window.PublicKeyCredential !== undefined;
};

const bufferToBase64 = (buffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
};

const base64ToBuffer = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

const FingerprintAttendance = () => {
  const [mode, setMode] = useState('home');
  const [userName, setUserName] = useState('');
  const [selectedUser, setSelectedUser] = useState('');
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const [webAuthnAvailable, setWebAuthnAvailable] = useState(false);

  useEffect(() => {
    loadRegisteredUsers();
    setWebAuthnAvailable(webAuthnSupported());
    const timer = setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadRegisteredUsers = () => {
    const usersData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('webauthn_user_')) {
        const userData = JSON.parse(localStorage.getItem(key));
        usersData[userData.id] = userData;
      }
    }
    setRegisteredUsers(Object.values(usersData));
  };

  const saveUserToLocalStorage = (user) => {
    localStorage.setItem(`webauthn_user_${user.id}`, JSON.stringify(user));
    loadRegisteredUsers();
  };

  const handleRegister = async () => {
    if (!userName.trim()) {
      setMessage({ text: 'Please enter your name', type: 'error' });
      return;
    }

    if (!webAuthnAvailable) {
      setMessage({ text: 'WebAuthn not supported on this device', type: 'error' });
      return;
    }

    const existingUser = registeredUsers.find(u => u.name.toLowerCase() === userName.toLowerCase());
    if (existingUser) {
      setMessage({ text: 'User already registered', type: 'error' });
      return;
    }

    setScanning(true);
    setMessage({ text: 'Please authenticate with your fingerprint/biometric...', type: 'info' });

    try {
      const userId = `user_${Date.now()}`;
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const publicKeyCredentialCreationOptions = {
        challenge: challenge,
        rp: {
          name: "Attendance System",
          id: window.location.hostname,
        },
        user: {
          id: new TextEncoder().encode(userId),
          name: userName.toLowerCase().replace(/\s+/g, '_'),
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
        },
        timeout: 60000,
        attestation: "none"
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyCredentialCreationOptions
      });

      const newUser = {
        id: userId,
        name: userName,
        credentialId: bufferToBase64(credential.rawId),
        publicKey: bufferToBase64(credential.response.getPublicKey()),
        registeredAt: new Date().toISOString()
      };

      saveUserToLocalStorage(newUser);
      setMessage({ text: `${userName} registered successfully!`, type: 'success' });
      setUserName('');
      setTimeout(() => {
        setMode('home');
        setMessage({ text: '', type: '' });
      }, 2000);
    } catch (error) {
      console.error('Registration error:', error);
      if (error.name === 'NotAllowedError') {
        setMessage({ text: 'Authentication cancelled or not allowed', type: 'error' });
      } else {
        setMessage({ text: 'Registration failed. Please try again.', type: 'error' });
      }
    } finally {
      setScanning(false);
    }
  };

  const handleAttendance = async () => {
    if (!selectedUser) {
      setMessage({ text: 'Please select a user', type: 'error' });
      return;
    }

    if (!webAuthnAvailable) {
      setMessage({ text: 'WebAuthn not supported on this device', type: 'error' });
      return;
    }

    setScanning(true);
    setMessage({ text: 'Please authenticate with your fingerprint/biometric...', type: 'info' });

    try {
      const user = registeredUsers.find(u => u.id === selectedUser);
      
      if (!user) {
        setMessage({ text: 'User not found', type: 'error' });
        setScanning(false);
        return;
      }

      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const publicKeyCredentialRequestOptions = {
        challenge: challenge,
        allowCredentials: [{
          id: base64ToBuffer(user.credentialId),
          type: 'public-key',
          transports: ['internal']
        }],
        timeout: 60000,
        userVerification: "required"
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyCredentialRequestOptions
      });

      // Verification successful - mark attendance
      const now = new Date();
      const attendanceData = {
        name: user.name,
        date: now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }),
        day: now.toLocaleDateString('en-US', { weekday: 'long' }),
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        timestamp: now.toISOString(),
        verified: true
      };

      await sendToGoogleSheets(attendanceData);
      
      setMessage({ text: `Attendance marked for ${user.name}! ✓`, type: 'success' });
      setSelectedUser('');
      setTimeout(() => {
        setMode('home');
        setMessage({ text: '', type: '' });
      }, 2000);
    } catch (error) {
      console.error('Authentication error:', error);
      if (error.name === 'NotAllowedError') {
        setMessage({ text: 'Authentication failed - fingerprint not recognized', type: 'error' });
      } else {
        setMessage({ text: 'Verification failed. Please try again.', type: 'error' });
      }
    } finally {
      setScanning(false);
    }
  };

  const sendToGoogleSheets = async (data) => {
    try {
      const response = await fetch(GOOGLE_SHEETS_CONFIG.webAppUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      if (GOOGLE_SHEETS_CONFIG.enableLogging) {
        console.log('Attendance data sent:', data);
      }
    } catch (error) {
      if (GOOGLE_SHEETS_CONFIG.enableLogging) {
        console.error('Error sending to Google Sheets:', error);
      }
      throw error;
    }
  };

  const formatDateTime = (date) => {
    return {
      date: date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      day: date.toLocaleDateString('en-US', { weekday: 'long' }),
      time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };
  };

  const dateTime = formatDateTime(currentDateTime);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-center mb-4">
            <Fingerprint className="w-12 h-12 text-indigo-600 mr-3" />
            <h1 className="text-3xl font-bold text-gray-800">Biometric Attendance</h1>
          </div>
          
          {!webAuthnAvailable && (
            <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
              <div className="flex">
                <AlertCircle className="w-5 h-5 text-yellow-400 mr-2" />
                <p className="text-sm text-yellow-700">
                  WebAuthn not supported on this browser/device. Please use a compatible device with biometric authentication.
                </p>
              </div>
            </div>
          )}
          
          {/* Current Date & Time */}
          <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-center text-gray-700">
              <Calendar className="w-5 h-5 mr-2" />
              <span className="font-semibold">{dateTime.date}</span>
              <span className="mx-2">•</span>
              <span className="font-semibold">{dateTime.day}</span>
            </div>
            <div className="flex items-center justify-center text-gray-700">
              <Clock className="w-5 h-5 mr-2" />
              <span className="font-semibold text-xl">{dateTime.time}</span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          {mode === 'home' && (
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">Select Action</h2>
              <button
                onClick={() => setMode('register')}
                disabled={!webAuthnAvailable}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <UserPlus className="w-6 h-6 mr-3" />
                Register New User
              </button>
              <button
                onClick={() => setMode('attendance')}
                disabled={registeredUsers.length === 0 || !webAuthnAvailable}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-lg flex items-center justify-center transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                <LogIn className="w-6 h-6 mr-3" />
                Mark Attendance
              </button>
              {registeredUsers.length === 0 && (
                <p className="text-center text-sm text-gray-500">Please register at least one user first</p>
              )}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <h3 className="text-lg font-semibold mb-3 text-gray-700">Registered Users ({registeredUsers.length})</h3>
                {registeredUsers.length > 0 ? (
                  <div className="space-y-2">
                    {registeredUsers.map(user => (
                      <div key={user.id} className="bg-gray-50 p-3 rounded-lg flex items-center">
                        <User className="w-5 h-5 text-gray-600 mr-3" />
                        <span className="text-gray-800">{user.name}</span>
                        <Fingerprint className="w-4 h-4 text-green-600 ml-auto" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center">No users registered yet</p>
                )}
              </div>
            </div>
          )}

          {mode === 'register' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Register User</h2>
                <button
                  onClick={() => {
                    setMode('home');
                    setUserName('');
                    setMessage({ text: '', type: '' });
                  }}
                  className="text-gray-600 hover:text-gray-800"
                >
                  ✕ Cancel
                </button>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Full Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter your name"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  disabled={scanning}
                />
              </div>

              {scanning && (
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-8 text-center">
                  <div className="animate-pulse flex flex-col items-center">
                    <div className="w-24 h-24 bg-indigo-600 rounded-full mb-4 flex items-center justify-center">
                      <Fingerprint className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-indigo-700 font-semibold">Authenticating...</p>
                    <p className="text-indigo-600 text-sm mt-2">Use your device's biometric sensor</p>
                  </div>
                </div>
              )}

              {message.text && (
                <div className={`p-4 rounded-lg flex items-center ${
                  message.type === 'success' ? 'bg-green-100 text-green-800' :
                  message.type === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {message.type === 'success' && <CheckCircle className="w-5 h-5 mr-2" />}
                  {message.type === 'error' && <AlertCircle className="w-5 h-5 mr-2" />}
                  {message.text}
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={scanning || !userName.trim() || !webAuthnAvailable}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Fingerprint className="w-5 h-5 mr-2" />
                {scanning ? 'Authenticating...' : 'Register Biometric'}
              </button>
            </div>
          )}

          {mode === 'attendance' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-800">Mark Attendance</h2>
                <button
                  onClick={() => {
                    setMode('home');
                    setSelectedUser('');
                    setMessage({ text: '', type: '' });
                  }}
                  className="text-gray-600 hover:text-gray-800"
                >
                  ✕ Cancel
                </button>
              </div>

              <div>
                <label className="block text-gray-700 font-semibold mb-2">Select User</label>
                <select
                  value={selectedUser}
                  onChange={(e) => setSelectedUser(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  disabled={scanning}
                >
                  <option value="">Choose a user...</option>
                  {registeredUsers.map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </select>
              </div>

              {scanning && (
                <div className="bg-indigo-50 border-2 border-indigo-200 rounded-lg p-8 text-center">
                  <div className="animate-pulse flex flex-col items-center">
                    <div className="w-24 h-24 bg-indigo-600 rounded-full mb-4 flex items-center justify-center">
                      <Fingerprint className="w-12 h-12 text-white" />
                    </div>
                    <p className="text-indigo-700 font-semibold">Verifying biometric...</p>
                    <p className="text-indigo-600 text-sm mt-2">Use your device's biometric sensor</p>
                  </div>
                </div>
              )}

              {message.text && (
                <div className={`p-4 rounded-lg flex items-center ${
                  message.type === 'success' ? 'bg-green-100 text-green-800' :
                  message.type === 'error' ? 'bg-red-100 text-red-800' :
                  'bg-blue-100 text-blue-800'
                }`}>
                  {message.type === 'success' && <CheckCircle className="w-5 h-5 mr-2" />}
                  {message.type === 'error' && <AlertCircle className="w-5 h-5 mr-2" />}
                  {message.text}
                </div>
              )}

              <button
                onClick={handleAttendance}
                disabled={scanning || !selectedUser || !webAuthnAvailable}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-lg transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
              >
                <Fingerprint className="w-5 h-5 mr-2" />
                {scanning ? 'Verifying...' : 'Verify Biometric & Mark Attendance'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FingerprintAttendance;