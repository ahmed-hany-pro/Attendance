import React, { useState, useEffect } from 'react';
import { Fingerprint, UserPlus, Clock, CheckCircle, XCircle, Users, Calendar } from 'lucide-react';

const GOOGLE_SHEETS_CONFIG = {
  webAppUrl: "https://script.google.com/macros/s/AKfycbwFY4c-Wl7w-_j1teh-mJG0HpLBjEyQGLHnE4GSTGgh_lHp_La4_peNWFfgmssPeXW0/exec",
  enableLogging: true
};

export default function FingerprintAttendance() {
  const [users, setUsers] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [newUserName, setNewUserName] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = () => {
    const savedUsers = JSON.parse(localStorage.getItem('fingerprintUsers') || '[]');
    setUsers(savedUsers);
  };

  const saveUsers = (updatedUsers) => {
    localStorage.setItem('fingerprintUsers', JSON.stringify(updatedUsers));
    setUsers(updatedUsers);
  };

  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 4000);
  };

  const checkWebAuthnSupport = () => {
    if (!window.PublicKeyCredential) {
      showMessage('Fingerprint authentication not supported on this device', 'error');
      return false;
    }
    return true;
  };

  const registerFingerprint = async () => {
    if (!newUserName.trim()) {
      showMessage('Please enter a name', 'error');
      return;
    }

    if (!checkWebAuthnSupport()) return;

    setLoading(true);
    try {
      const userId = new Uint8Array(16);
      crypto.getRandomValues(userId);

      const publicKeyOptions = {
        challenge: new Uint8Array(32),
        rp: {
          name: "Attendance System",
          id: window.location.hostname
        },
        user: {
          id: userId,
          name: newUserName.trim(),
          displayName: newUserName.trim()
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" }
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required"
        },
        timeout: 60000,
        attestation: "none"
      };

      crypto.getRandomValues(publicKeyOptions.challenge);

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions
      });

      const newUser = {
        id: Array.from(userId).join(','),
        name: newUserName.trim(),
        credentialId: Array.from(new Uint8Array(credential.rawId)).join(','),
        registeredAt: new Date().toISOString()
      };

      const updatedUsers = [...users, newUser];
      saveUsers(updatedUsers);

      showMessage(`${newUserName} registered successfully!`, 'success');
      setNewUserName('');
      setCurrentView('home');
    } catch (error) {
      console.error('Registration error:', error);
      showMessage('Registration failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const markAttendance = async () => {
    if (!checkWebAuthnSupport()) return;

    setLoading(true);
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const publicKeyOptions = {
        challenge: challenge,
        rpId: window.location.hostname,
        userVerification: "required",
        timeout: 60000
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyOptions
      });

      const credentialId = Array.from(new Uint8Array(assertion.rawId)).join(',');
      const user = users.find(u => u.credentialId === credentialId);

      if (user) {
        const now = new Date();
        const date = now.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: '2-digit', 
          day: '2-digit' 
        });
        const day = now.toLocaleDateString('en-US', { weekday: 'long' });
        const time = now.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          second: '2-digit',
          hour12: true 
        });

        await sendToGoogleSheets({
          name: user.name,
          date: date,
          day: day,
          time: time
        });

        showMessage(`Attendance marked for ${user.name}`, 'success');
      } else {
        showMessage('User not found. Please register first.', 'error');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      showMessage('Authentication failed. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const sendToGoogleSheets = async (data) => {
    if (GOOGLE_SHEETS_CONFIG.enableLogging) {
      console.log('Sending to Google Sheets:', data);
    }

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
        console.log('Data sent successfully');
      }
    } catch (error) {
      console.error('Error sending to Google Sheets:', error);
      throw error;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 mb-4 text-white">
          <div className="flex items-center justify-center mb-2">
            <Fingerprint className="w-12 h-12 mr-3" />
            <h1 className="text-3xl font-bold">Attendance System</h1>
          </div>
          <p className="text-center text-purple-200">Secure Fingerprint Authentication</p>
        </div>

        {/* Message Display */}
        {message.text && (
          <div className={`mb-4 p-4 rounded-lg flex items-center ${
            message.type === 'success' 
              ? 'bg-green-500/20 text-green-100 border border-green-400' 
              : 'bg-red-500/20 text-red-100 border border-red-400'
          }`}>
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 mr-2" />
            ) : (
              <XCircle className="w-5 h-5 mr-2" />
            )}
            {message.text}
          </div>
        )}

        {/* Main Content */}
        {currentView === 'home' && (
          <div className="space-y-4">
            <button
              onClick={markAttendance}
              disabled={loading || users.length === 0}
              className="w-full bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-6 px-6 rounded-xl shadow-lg transform transition hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              <Clock className="w-6 h-6 mr-3" />
              {loading ? 'Processing...' : 'Mark Attendance'}
            </button>

            <button
              onClick={() => setCurrentView('register')}
              className="w-full bg-white/10 hover:bg-white/20 backdrop-blur text-white font-bold py-6 px-6 rounded-xl shadow-lg transform transition hover:scale-105 flex items-center justify-center"
            >
              <UserPlus className="w-6 h-6 mr-3" />
              Register New User
            </button>

            <button
              onClick={() => setCurrentView('users')}
              className="w-full bg-white/10 hover:bg-white/20 backdrop-blur text-white font-bold py-6 px-6 rounded-xl shadow-lg transform transition hover:scale-105 flex items-center justify-center"
            >
              <Users className="w-6 h-6 mr-3" />
              View Users ({users.length})
            </button>
          </div>
        )}

        {currentView === 'register' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-white">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <UserPlus className="w-6 h-6 mr-2" />
              Register New User
            </h2>
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              placeholder="Enter full name"
              className="w-full px-4 py-3 rounded-lg bg-white/20 border border-white/30 text-white placeholder-purple-200 mb-4 focus:outline-none focus:ring-2 focus:ring-purple-400"
              disabled={loading}
            />
            <div className="flex gap-3">
              <button
                onClick={registerFingerprint}
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50"
              >
                {loading ? 'Registering...' : 'Register Fingerprint'}
              </button>
              <button
                onClick={() => {
                  setCurrentView('home');
                  setNewUserName('');
                }}
                className="px-6 py-3 bg-white/20 hover:bg-white/30 rounded-lg font-bold"
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {currentView === 'users' && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-6 text-white">
            <h2 className="text-2xl font-bold mb-4 flex items-center">
              <Users className="w-6 h-6 mr-2" />
              Registered Users
            </h2>
            {users.length === 0 ? (
              <p className="text-purple-200 text-center py-8">No users registered yet</p>
            ) : (
              <div className="space-y-3 mb-4">
                {users.map((user, index) => (
                  <div key={index} className="bg-white/20 rounded-lg p-4">
                    <div className="font-bold text-lg">{user.name}</div>
                    <div className="text-sm text-purple-200">
                      Registered: {new Date(user.registeredAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setCurrentView('home')}
              className="w-full px-6 py-3 bg-white/20 hover:bg-white/30 rounded-lg font-bold"
            >
              Back to Home
            </button>
          </div>
        )}

        {/* Info Section */}
        <div className="mt-6 bg-white/10 backdrop-blur-lg rounded-2xl p-4 text-white text-sm">
          <p className="text-purple-200 text-center">
            <Calendar className="w-4 h-4 inline mr-1" />
            Attendance data is automatically saved to Google Sheets
          </p>
        </div>
      </div>
    </div>
  );
}