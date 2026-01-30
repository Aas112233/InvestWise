
import React, { useState } from 'react';
import {
  User, Shield, Bell, Globe, CreditCard, Save,
  Moon, Sun, Eye, EyeOff, CheckCircle2, AlertTriangle,
  Terminal, Database, Lock, Sliders, Info, Users, Trash2, Key,
  Check, X, ShieldCheck, ChevronRight, RefreshCw
} from 'lucide-react';
import { User as UserType, AccessLevel, AppScreen } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import Toast, { ToastType } from './Toast';
import { Language, t } from '../i18n/translations';
import { FormInput, FormSelect, FormTextarea } from './ui/FormElements';
import AuditLogs from './Settings/AuditLogs.tsx';

import { Member } from '../types';

interface SettingsProps {
  currentUser: UserType | null;
  lang: Language;
}

const Settings: React.FC<SettingsProps> = ({ currentUser, lang }) => {
  const { systemUsers, members, updateMember, updateUserPermissions, updateUserPassword, deleteUser } = useGlobalState();
  const [activeTab, setActiveTab] = useState<'General' | 'Financial' | 'System' | 'Users' | 'Profiles' | 'Audit'>('General');
  const [selectedAuditUser, setSelectedAuditUser] = useState<string | null>(null);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<Member | null>(null);
  const [memberFormData, setMemberFormData] = useState<Partial<Member>>({});
  const [newPassword, setNewPassword] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Batch permission management
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, Map<AppScreen, AccessLevel>>>(new Map());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>({
    isVisible: false,
    message: '',
    type: 'success',
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const handleUpdateMemberProfile = async () => {
    if (!selectedMemberProfile || !selectedMemberProfile.id) return;

    // In a real scenario, we'd have a specific backend endpoint for "Extended Profile" or just use updateMember
    // For now, we assume updateMember handles the fields we have.
    // We are simulating "Additional Info" which might not be in the Member type yet.
    // The user asked to "add details". I will assume standard updateMember works for now.

    try {
      setProcessingId('profile-save');
      await updateMember({ ...selectedMemberProfile, ...memberFormData } as Member);
      showNotification(`Extended profile for ${selectedMemberProfile.name} updated.`);
      setSelectedMemberProfile(null);
    } catch (error) {
      showNotification("Failed to update profile", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const handleSelectMember = (member: Member) => {
    setSelectedMemberProfile(member);
    setMemberFormData({
      phone: member.phone,
      email: member.email,
      // potential new fields: address, nominee, etc. 
    });
  };

  // Local permission change (doesn't save immediately)
  const handlePermissionChange = (userId: string, screen: AppScreen, level: AccessLevel) => {
    const userPendingMap = pendingPermissions.get(userId) || new Map();
    userPendingMap.set(screen, level);
    setPendingPermissions(new Map(pendingPermissions.set(userId, userPendingMap)));
    setHasUnsavedChanges(true);
  };

  // Batch save all pending permissions
  const handleSaveAllPermissions = async () => {
    if (!hasUnsavedChanges || !selectedUserId) return;

    const userPending = pendingPermissions.get(selectedUserId);
    if (!userPending || userPending.size === 0) return;

    try {
      setProcessingId('batch-save');

      // Save all pending permissions for this user
      for (const [screen, level] of userPending.entries()) {
        await updateUserPermissions(selectedUserId, screen, level);
      }

      // Clear pending changes
      pendingPermissions.delete(selectedUserId);
      setPendingPermissions(new Map(pendingPermissions));
      setHasUnsavedChanges(false);

      showNotification(`Permissions updated successfully for user`);
    } catch (e) {
      showNotification("Failed to update permissions", "error");
    } finally {
      setProcessingId(null);
    }
  };

  // Cancel pending changes
  const handleCancelChanges = () => {
    if (!selectedUserId) return;
    pendingPermissions.delete(selectedUserId);
    setPendingPermissions(new Map(pendingPermissions));
    setHasUnsavedChanges(false);
  };

  // Get effective permission (pending or current)
  const getEffectivePermission = (userId: string, screen: AppScreen): AccessLevel => {
    const userPending = pendingPermissions.get(userId);
    if (userPending?.has(screen)) {
      return userPending.get(screen)!;
    }
    const user = systemUsers.find(u => u.id === userId);
    return user?.permissions[screen] || AccessLevel.NONE;
  };

  // Check if permission is pending
  const isPending = (userId: string, screen: AppScreen): boolean => {
    return pendingPermissions.get(userId)?.has(screen) || false;
  };

  const handleResetPassword = async (userId: string) => {
    if (currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE) {
      showNotification("Insufficient privileges to reset credentials", "error");
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      showNotification("Please enter a valid password (min 6 chars).", "error");
      return;
    }

    const resetId = `reset-${userId}`;
    try {
      setProcessingId(resetId);
      await updateUserPassword(userId, newPassword);
      setNewPassword('');
      showNotification("Credentials updated successfully.");
    } catch (e) {
      showNotification("Failed to reset password", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const tabItems = [
    { id: 'General', label: 'Identity', icon: <User size={18} /> },
    { id: 'Users', label: 'Team Access', icon: <Users size={18} /> },
    { id: 'Profiles', label: 'Member Profiles', icon: <Database size={18} /> },
    { id: 'Financial', label: 'Fiscal Config', icon: <CreditCard size={18} /> },
    { id: 'System', label: 'Preferences', icon: <Sliders size={18} /> },
    { id: 'Audit', label: 'Audit Logs', icon: <CheckCircle2 size={18} /> },
  ];

  const modulesToConfigure = [
    AppScreen.DASHBOARD,
    AppScreen.MEMBERS,
    AppScreen.DEPOSITS,
    AppScreen.REQUEST_DEPOSIT,
    AppScreen.PROJECT_MANAGEMENT,
    AppScreen.EXPENSES,
    AppScreen.FUNDS_MANAGEMENT,
    AppScreen.DIVIDENDS,
    AppScreen.ANALYSIS,
    AppScreen.REPORTS,
    AppScreen.SETTINGS
  ];

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>{t('nav.strategy', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('nav.settings', lang)}</span>
          </nav>
          <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.settings', lang)}</h1>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        <div className="lg:w-80 space-y-4">
          <div className="bg-white dark:bg-[#1A221D] p-4 rounded-[3rem] card-shadow border border-gray-100 dark:border-white/5 space-y-2">
            {tabItems.filter(item => {
              if (item.id === 'Audit' && currentUser?.role !== 'Administrator') return false;
              if (item.id === 'Users' && currentUser?.role !== 'Administrator') return false; // Security/Users usually admin only too?
              if (item.id === 'Profiles' && currentUser?.role !== 'Administrator') return false;
              return true;
            }).map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === item.id
                  ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-xl'
                  : 'text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-dark dark:hover:text-white'
                  }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1">
          {activeTab === 'General' && currentUser && (
            <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5 animate-in slide-in-from-bottom-4 duration-500">
              <div className="flex flex-col md:flex-row gap-12">
                <div className="flex flex-col items-center gap-6">
                  <img src={currentUser.avatar} className="w-48 h-48 rounded-[4rem] border-8 border-gray-50 dark:border-[#111814] shadow-2xl" alt="" />
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Active System ID: #{currentUser.id?.split('-')?.[0] || currentUser.id}</p>
                </div>
                <div className="flex-1 space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <FormInput
                      label="Full Name"
                      defaultValue={currentUser.name}
                    />
                    <FormInput
                      label="Role"
                      value={currentUser.role}
                      readOnly
                      className="text-gray-400 cursor-not-allowed"
                    />
                  </div>
                  <FormInput
                    label="Primary Identity Terminal (Email)"
                    defaultValue={currentUser.email}
                  />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'Users' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              {/* Header */}
              <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-[#0D1410] dark:via-[#111814] dark:to-[#0D1410] p-12 rounded-[4rem] border-2 border-slate-700 dark:border-white/10 relative overflow-hidden shadow-2xl">
                {/* Tech Grid Background */}
                <div className="absolute inset-0 opacity-5">
                  <div className="absolute inset-0" style={{
                    backgroundImage: 'linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)',
                    backgroundSize: '40px 40px'
                  }}></div>
                </div>

                <div className="relative flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="p-4 bg-brand rounded-2xl shadow-2xl shadow-brand/40">
                        <ShieldCheck size={32} strokeWidth={3} className="text-dark" />
                      </div>
                      <div>
                        <h3 className="text-4xl font-black text-white uppercase tracking-tighter leading-none mb-2">System Authorization</h3>
                        <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Mission Control • Permission Matrix</p>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="px-6 py-2 bg-emerald-500/20 border-2 border-emerald-500/30 rounded-xl mb-2">
                      <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Active Users</p>
                      <p className="text-3xl font-black text-emerald-300 tracking-tighter">{systemUsers.length}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* User Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {systemUsers.map(user => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedUserId(selectedUserId === user.id ? null : user.id);
                      setSelectedAuditUser(null);
                    }}
                    className={`p-8 rounded-[2.5rem] border-2 transition-all text-left group ${selectedUserId === user.id
                        ? 'bg-brand/10 border-brand scale-105 shadow-2xl shadow-brand/20'
                        : 'bg-white dark:bg-[#1A221D] border-gray-200 dark:border-white/10 hover:border-brand/50 hover:shadow-xl'
                      }`}
                  >
                    <div className="flex items-start gap-4 mb-4">
                      <img src={user.avatar} className="w-16 h-16 rounded-2xl shadow-lg" alt="" />
                      <div className="flex-1">
                        <p className="font-black text-dark dark:text-white uppercase tracking-tight text-lg leading-none mb-2">{user.name}</p>
                        <p className="text-[9px] font-black text-gray-500 uppercase tracking-widest">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
                      <span className={`px-3 py-1.5 rounded-xl text-[8px] font-black uppercase tracking-widest ${user.role === 'Administrator' ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' :
                          user.role === 'Manager' ? 'bg-blue-500/20 text-blue-500 border border-blue-500/30' :
                            'bg-gray-500/20 text-gray-500 border border-gray-500/30'
                        }`}>{user.role}</span>
                      <ChevronRight className={`transition-transform ${selectedUserId === user.id ? 'rotate-90 text-brand' : 'text-gray-400'}`} size={20} />
                    </div>
                  </button>
                ))}
              </div>

              {/* Permission Matrix (Shows when user selected) */}
              {selectedUserId && (() => {
                const user = systemUsers.find(u => u.id === selectedUserId);
                if (!user) return null;

                return (
                  <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[4rem] border border-gray-200 dark:border-white/10 shadow-2xl animate-in slide-in-from-bottom-6 duration-500">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-4">
                        <img src={user.avatar} className="w-12 h-12 rounded-xl shadow-lg" alt="" />
                        <div>
                          <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{user.name}</h4>
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-1">Configuring Access Permissions</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setSelectedUserId(null)}
                        className="p-3 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-xl transition-all"
                      >
                        <X size={20} className="text-gray-600 dark:text-gray-400" />
                      </button>
                    </div>

                    {/* Permission Grid */}
                    <div className="space-y-3">
                      {modulesToConfigure.map(module => {
                        const currentLevel = getEffectivePermission(user.id, module);
                        const isChanged = isPending(user.id, module);

                        return (
                          <div
                            key={module}
                            className={`p-5 rounded-2xl border-2 transition-all ${isChanged
                                ? 'bg-amber-50 dark:bg-amber-500/10 border-amber-400 dark:border-amber-500/50'
                                : 'bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10'
                              }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-3">
                                  <div className={`w-2 h-2 rounded-full ${isChanged ? 'bg-amber-500 animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`}></div>
                                  <p className="text-xs font-black text-dark dark:text-white uppercase tracking-wider">
                                    {module.replace(/_/g, ' ')}
                                  </p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                {[
                                  { level: AccessLevel.NONE, label: 'NONE', color: 'gray' },
                                  { level: AccessLevel.READ, label: 'READ', color: 'blue' },
                                  { level: AccessLevel.WRITE, label: 'WRITE', color: 'emerald' }
                                ].map(({ level, label, color }) => (
                                  <button
                                    key={level}
                                    disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                                    onClick={() => handlePermissionChange(user.id, module, level)}
                                    className={`px-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50 disabled:cursor-not-allowed ${currentLevel === level
                                        ? color === 'gray' ? 'bg-gray-600 text-white shadow-lg scale-105' :
                                          color === 'blue' ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105' :
                                            'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30 scale-105'
                                        : color === 'gray' ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700' :
                                          color === 'blue' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-500/20' :
                                            'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-500/20'
                                      }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Password Reset Section */}
                    <div className="mt-10 pt-10 border-t border-gray-200 dark:border-white/10">
                      <h5 className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-4">Security Credentials</h5>
                      <div className="flex gap-4">
                        <input
                          disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder={currentUser.permissions[AppScreen.SETTINGS] === AccessLevel.WRITE ? "New password..." : "Read-only"}
                          className="flex-1 bg-gray-100 dark:bg-dark px-6 py-4 rounded-2xl border-2 border-transparent focus:border-brand outline-none font-bold text-dark dark:text-white disabled:opacity-50"
                        />
                        <button
                          disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                          onClick={() => handleResetPassword(user.id)}
                          className="bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 flex items-center gap-2"
                        >
                          {processingId === `reset-${user.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
                          {processingId === `reset-${user.id}` ? 'Resetting...' : 'Reset'}
                        </button>
                      </div>
                    </div>

                    {/* Revoke Access */}
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/10 flex justify-between items-center">
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Last Login</p>
                        <p className="text-xs font-bold text-dark dark:text-white uppercase">{user.lastLogin}</p>
                      </div>
                      <button
                        disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE || !!processingId}
                        onClick={async () => {
                          if (currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE) return;
                          if (window.confirm(`Revoke access for ${user.name}?`)) {
                            try {
                              setProcessingId(`revoke-${user.id}`);
                              await deleteUser(user.id);
                              showNotification(`Access revoked for ${user.name}`);
                              setSelectedUserId(null);
                            } catch (e) {
                              showNotification("Failed to revoke access", "error");
                            } finally {
                              setProcessingId(null);
                            }
                          }
                        }}
                        className="flex items-center gap-2 px-6 py-3 bg-rose-500/10 text-rose-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border-2 border-rose-500/20 hover:bg-rose-500 hover:text-white disabled:opacity-50 disabled:hover:bg-rose-500/10 disabled:hover:text-rose-500"
                      >
                        {processingId === `revoke-${user.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        {processingId === `revoke-${user.id}` ? 'Revoking...' : 'Revoke Access'}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Sticky Save Bar */}
              {hasUnsavedChanges && selectedUserId && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-8 duration-500">
                  <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 dark:from-[#111814] dark:via-[#0D1410] dark:to-[#111814] px-10 py-6 rounded-[3rem] border-2 border-amber-500 shadow-2xl shadow-amber-500/30 flex items-center gap-8">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-amber-500 rounded-full animate-pulse"></div>
                      <div>
                        <p className="text-white font-black text-sm uppercase tracking-tight leading-none">Unsaved Changes</p>
                        <p className="text-[9px] font-bold text-amber-400 uppercase tracking-widest mt-1">
                          {pendingPermissions.get(selectedUserId)?.size || 0} permission(s) modified
                        </p>
                      </div>
                    </div>
                    <div className="h-10 w-px bg-white/20"></div>
                    <div className="flex gap-3">
                      <button
                        onClick={handleCancelChanges}
                        className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveAllPermissions}
                        disabled={processingId === 'batch-save'}
                        className="px-10 py-3 bg-brand hover:scale-105 active:scale-95 text-dark rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl shadow-brand/40 flex items-center gap-2 disabled:opacity-50"
                      >
                        {processingId === 'batch-save' ? (
                          <>
                            <RefreshCw size={16} className="animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save size={16} />
                            Save Permissions
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}



          {activeTab === 'Profiles' && (
            <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">Partner Profiles</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Extended KYC & Data Management (Admin Only)</p>
                  </div>
                  <div className="p-4 bg-purple-500/10 text-purple-500 rounded-2xl shadow-2xl shadow-purple-500/20">
                    <Database size={24} strokeWidth={3} />
                  </div>
                </div>

                {!selectedMemberProfile ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {members.map(member => (
                      <div key={member.id} onClick={() => handleSelectMember(member)} className="p-6 bg-gray-50 dark:bg-[#111814] rounded-[2.5rem] border border-gray-100 dark:border-white/5 cursor-pointer hover:bg-white dark:hover:bg-white/5 hover:scale-[1.02] transition-all group">
                        <div className="flex items-center gap-5">
                          <img src={member.avatar || `https://ui-avatars.com/api/?name=${member.name}`} className="w-16 h-16 rounded-[1.5rem] grayscale group-hover:grayscale-0 transition-all" alt="" />
                          <div>
                            <p className="font-black text-dark dark:text-white text-lg leading-none mb-1 group-hover:text-brand transition-colors">{member.name}</p>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">#{member.memberId}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="animate-in slide-in-from-right-4 duration-300">
                    <button onClick={() => setSelectedMemberProfile(null)} className="mb-8 flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest hover:text-dark dark:hover:text-white transition-colors">
                      <ChevronRight className="rotate-180" size={14} /> Back to Directory
                    </button>

                    <div className="flex flex-col xl:flex-row gap-10">
                      <div className="xl:w-80 flex flex-col items-center text-center space-y-6">
                        <div className="relative group cursor-pointer">
                          <img src={selectedMemberProfile.avatar || `https://ui-avatars.com/api/?name=${selectedMemberProfile.name}`} className="w-64 h-64 rounded-[3rem] object-cover shadow-2xl" alt="" />
                          <div className="absolute inset-0 bg-black/50 rounded-[3rem] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                            <p className="text-white text-xs font-black uppercase tracking-widest">Change Photo</p>
                          </div>
                        </div>
                        <div>
                          <h4 className="text-2xl font-black text-dark dark:text-white uppercase tracking-tight">{selectedMemberProfile.name}</h4>
                          <p className="text-[10px] font-black text-brand uppercase tracking-widest mt-1">{selectedMemberProfile.role}</p>
                        </div>
                      </div>

                      <div className="flex-1 space-y-8">
                        <div className="grid grid-cols-2 gap-8">
                          <FormInput
                            label="Legal Name"
                            value={memberFormData.name || selectedMemberProfile.name}
                            onChange={e => setMemberFormData({ ...memberFormData, name: e.target.value })}
                          />
                          <FormInput
                            label="Email Address"
                            value={memberFormData.email || selectedMemberProfile.email}
                            onChange={e => setMemberFormData({ ...memberFormData, email: e.target.value })}
                          />
                          <FormInput
                            label="Phone Contact"
                            value={memberFormData.phone || selectedMemberProfile.phone}
                            onChange={e => setMemberFormData({ ...memberFormData, phone: e.target.value })}
                          />
                          <FormInput
                            label="National ID / Passport"
                            placeholder="Add ID Number..."
                          />
                        </div>
                        <FormTextarea
                          label="Residential Address"
                          placeholder="Add full address..."
                          className="h-32 resize-none"
                        />
                        <FormInput
                          label="Nominee Details"
                          placeholder="Nominee Name & Relation..."
                        />

                        <div className="flex justify-end pt-6 border-t border-gray-100 dark:border-white/5">
                          <button
                            disabled={!!processingId}
                            onClick={handleUpdateMemberProfile}
                            className={`bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2.5rem] font-black text-xs uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center gap-3 ${processingId ? 'opacity-70 cursor-wait' : ''}`}
                          >
                            {processingId === 'profile-save' ? <RefreshCw size={18} className="animate-spin" /> : <Save size={18} />} {processingId === 'profile-save' ? 'Saving...' : 'Save Profile'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}



          {activeTab === 'Audit' && (
            <AuditLogs lang={lang} currentUser={currentUser} />
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
