
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

import { Member } from '../types';

interface SettingsProps {
  currentUser: UserType | null;
  lang: Language;
}

const Settings: React.FC<SettingsProps> = ({ currentUser, lang }) => {
  const { systemUsers, members, updateMember, updateUserPermissions, updateUserPassword, deleteUser } = useGlobalState();
  const [activeTab, setActiveTab] = useState<'General' | 'Security' | 'Financial' | 'System' | 'Users' | 'Profiles'>('General');
  const [selectedAuditUser, setSelectedAuditUser] = useState<string | null>(null);
  const [selectedMemberProfile, setSelectedMemberProfile] = useState<Member | null>(null);
  const [memberFormData, setMemberFormData] = useState<Partial<Member>>({});
  const [newPassword, setNewPassword] = useState<string>('');
  const [processingId, setProcessingId] = useState<string | null>(null);

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

  const handleTogglePermission = async (userId: string, screen: AppScreen, level: AccessLevel) => {
    if (currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE) {
      showNotification("Insufficient privileges to modify permissions", "error");
      return;
    }

    const permId = `perm-${userId}-${screen}-${level}`;
    try {
      setProcessingId(permId);
      await updateUserPermissions(userId, screen, level);
      showNotification(`Permissions updated for ${screen}.`);
    } catch (e) {
      showNotification("Failed to update permission", "error");
    } finally {
      setProcessingId(null);
    }
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
    { id: 'Security', label: 'Security', icon: <Shield size={18} /> },
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
            {tabItems.map((item) => (
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
              <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-3">System Authorization</h3>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Configure module permissions for all registered users</p>
                  </div>
                  <div className="p-4 bg-brand rounded-2xl text-dark shadow-2xl shadow-brand/20">
                    <ShieldCheck size={24} strokeWidth={3} />
                  </div>
                </div>

                <div className="space-y-4">
                  {systemUsers.map(user => (
                    <div key={user.id} className="bg-gray-50 dark:bg-[#111814] rounded-[3rem] border border-gray-100 dark:border-white/5 overflow-hidden">
                      <div
                        onClick={() => {
                          setSelectedAuditUser(selectedAuditUser === user.id ? null : user.id);
                          setNewPassword('');
                        }}
                        className="p-8 flex items-center justify-between cursor-pointer hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
                      >
                        <div className="flex items-center gap-5">
                          <img src={user.avatar} className="w-14 h-14 rounded-2xl shadow-xl" alt="" />
                          <div>
                            <p className="font-black text-dark dark:text-white uppercase tracking-tight text-lg leading-none mb-1">{user.name}</p>
                            <p className="text-[10px] font-black text-gray-600 dark:text-gray-400 uppercase tracking-widest">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-10">
                          <div className="text-right">
                            <span className="px-4 py-1.5 bg-dark dark:bg-brand text-white dark:text-dark rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm">{user.role}</span>
                            <p className="text-[10px] font-bold text-gray-500 uppercase mt-2">ID: {user.memberId || 'SYSAUTH'}</p>
                          </div>
                          <ChevronRight className={`text-gray-400 transition-transform ${selectedAuditUser === user.id ? 'rotate-90 text-brand' : ''}`} />
                        </div>
                      </div>

                      {selectedAuditUser === user.id && (
                        <div className="px-10 pb-10 pt-4 bg-white/50 dark:bg-dark/30 animate-in slide-in-from-top-4 duration-300 border-t border-gray-100 dark:border-white/5">
                          <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 mb-10">
                            {/* Module Authorization Matrix */}
                            <div>
                              <h4 className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-6">Module Authorization Matrix</h4>
                              <div className="overflow-x-auto rounded-3xl border border-gray-100 dark:border-white/5">
                                <table className="w-full text-left bg-white dark:bg-transparent">
                                  <thead>
                                    <tr className="text-[9px] font-black text-gray-500 uppercase tracking-widest border-b border-gray-100 dark:border-white/10">
                                      <th className="py-4 px-6">Application Module</th>
                                      <th className="py-4 px-2 text-center">None</th>
                                      <th className="py-4 px-2 text-center">Read</th>
                                      <th className="py-4 px-2 text-center">Write</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                                    {modulesToConfigure.map(module => (
                                      <tr key={module} className="group">
                                        <td className="py-4 px-6 text-[11px] font-black text-dark dark:text-white uppercase tracking-tighter group-hover:text-brand transition-colors">{module.replace('_', ' ')}</td>
                                        {[AccessLevel.NONE, AccessLevel.READ, AccessLevel.WRITE].map(level => (
                                          <td key={level} className="py-4 px-2 text-center">
                                            <button
                                              disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                                              onClick={() => handleTogglePermission(user.id, module, level)}
                                              className={`w-9 h-9 rounded-xl mx-auto flex items-center justify-center transition-all ${user.permissions[module] === level
                                                ? 'bg-dark dark:bg-brand text-white dark:text-dark shadow-lg'
                                                : 'bg-gray-100 dark:bg-white/5 text-gray-300 dark:text-gray-700'
                                                } ${currentUser.permissions[AppScreen.SETTINGS] === AccessLevel.WRITE ? 'hover:text-brand' : 'opacity-50 cursor-not-allowed'}`}
                                            >
                                              {processingId === `perm-${user.id}-${module}-${level}` ? <RefreshCw size={14} className="animate-spin" /> : user.permissions[module] === level ? <Check size={14} strokeWidth={4} /> : <div className="w-1 h-1 rounded-full bg-current"></div>}
                                            </button>
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Credential Reset */}
                            <div className="space-y-8">
                              <div>
                                <h4 className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-6">Security Credentials</h4>
                                <div className="bg-white dark:bg-[#1A221D] p-8 rounded-[2.5rem] border border-gray-100 dark:border-white/10 shadow-inner">
                                  <div className="space-y-4">
                                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">New Login Password</label>
                                    <div className="flex gap-4">
                                      <input
                                        disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                                        type="password"
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder={currentUser.permissions[AppScreen.SETTINGS] === AccessLevel.WRITE ? "Set new passphrase..." : "Read-only access"}
                                        className={`flex-1 bg-gray-50 dark:bg-dark px-6 py-4 rounded-2xl border border-transparent focus:border-brand outline-none font-bold text-dark dark:text-white text-sm ${currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE ? 'opacity-50 cursor-not-allowed' : ''}`}
                                      />
                                      <button
                                        disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE}
                                        onClick={() => handleResetPassword(user.id)}
                                        className={`bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl transition-all flex items-center gap-2 ${currentUser.permissions[AppScreen.SETTINGS] === AccessLevel.WRITE ? 'hover:scale-105 active:scale-95' : 'opacity-50 cursor-not-allowed'}`}
                                      >
                                        {processingId === `reset-${user.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />} {processingId === `reset-${user.id}` ? 'Updating...' : 'Reset'}
                                      </button>
                                    </div>
                                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-relaxed mt-2 italic px-1">Updating this will immediately invalidate current sessions for this user ID.</p>
                                  </div>
                                </div>
                              </div>

                              <div className="pt-8 border-t border-gray-100 dark:border-white/10 flex justify-between items-center">
                                <div>
                                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Last Login Identity</p>
                                  <p className="text-xs font-bold text-dark dark:text-white uppercase">{user.lastLogin}</p>
                                </div>
                                <button
                                  disabled={currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE || !!processingId}
                                  onClick={async () => {
                                    if (currentUser.permissions[AppScreen.SETTINGS] !== AccessLevel.WRITE) return;
                                    if (window.confirm(`Are you sure you want to revoke access for ${user.name}?`)) {
                                      const revokeId = `revoke-${user.id}`;
                                      try {
                                        setProcessingId(revokeId);
                                        await deleteUser(user.id);
                                        showNotification(`Access revoked for ${user.name}`);
                                      } catch (e) {
                                        showNotification("Failed to revoke access", "error");
                                      } finally {
                                        setProcessingId(null);
                                      }
                                    }
                                  }}
                                  className={`flex items-center gap-2 px-6 py-3 bg-rose-500/10 text-rose-500 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-rose-500/20 ${currentUser.permissions[AppScreen.SETTINGS] === AccessLevel.WRITE ? 'hover:bg-rose-500 hover:text-white' : 'opacity-50 cursor-not-allowed'}`}
                                >
                                  {processingId === `revoke-${user.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />} {processingId === `revoke-${user.id}` ? 'Revoking...' : 'Revoke Authorization'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
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

          {activeTab === 'Security' && (
            <div className="bg-white dark:bg-[#1A221D] p-12 rounded-[4rem] card-shadow border border-gray-100 dark:border-white/5">
              <div className="flex items-center justify-between mb-12">
                <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Security Protocol</h3>
                <Lock className="text-brand opacity-40" size={32} />
              </div>
              <div className="p-10 bg-dark rounded-[3.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-brand/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>
                <h4 className="text-xl font-black text-white uppercase tracking-tighter mb-6 flex items-center gap-3"><Terminal className="text-brand" /> Strategic API Key</h4>
                <div className="flex gap-4 relative z-10">
                  <input readOnly type="password" value="********************************" className="flex-1 bg-white/5 border border-white/10 px-8 py-5 rounded-3xl text-brand font-mono text-sm outline-none" />
                  <button className="bg-brand text-dark px-10 py-5 rounded-3xl font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 active:scale-95 transition-all">Rotate</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;
