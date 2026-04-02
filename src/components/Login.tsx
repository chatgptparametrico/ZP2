'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { usePresentationStore } from '@/lib/presentation-store';

interface LoginProps {
  onLoginSuccess: () => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // Simple client-side auth state
        localStorage.setItem('zirkel-auth', JSON.stringify(data.user));
        onLoginSuccess();
      } else {
        setError(data.error || 'Credenciales inválidas');
      }
    } catch (err) {
      setError('Error de conexión');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50">
      <div className="bg-[#0f0f1a] border border-cyan-500/30 p-8 rounded-2xl shadow-[0_0_40px_rgba(0,255,255,0.1)] w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/zirkel/zirkel-logo.png" alt="Zirkel Logo" className="h-16 mx-auto mb-4" />
          <h1 className="text-2xl font-light text-white tracking-widest">
            ZIRKEL <span className="font-bold text-cyan-400">P</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2">Acceso a Presentación Paramétrica</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-cyan-400/80 text-xs uppercase tracking-wider mb-2">Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#1a1a2e] border border-cyan-900/50 text-white px-4 py-3 rounded-xl focus:border-cyan-400 focus:outline-none transition-colors"
              placeholder="Ingrese su usuario..."
              required
            />
          </div>
          
          <div>
            <label className="block text-cyan-400/80 text-xs uppercase tracking-wider mb-2">Contraseña</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-[#1a1a2e] border border-cyan-900/50 text-white px-4 py-3 rounded-xl focus:border-cyan-400 focus:outline-none transition-colors pr-12"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-500/50 hover:text-cyan-400 transition-colors focus:outline-none"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="text-red-400 text-sm text-center bg-red-900/20 py-2 rounded-lg border border-red-500/20">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold py-3 rounded-xl transition-all shadow-[0_0_20px_rgba(0,255,255,0.2)] hover:shadow-[0_0_30px_rgba(0,255,255,0.4)] disabled:opacity-50 disabled:cursor-not-allowed mt-6"
          >
            {isLoading ? 'Conectando...' : 'INGRESAR'}
          </button>
        </form>
      </div>
    </div>
  );
}
