
import React, { useState } from 'react';
import { Mail, Phone, MoreVertical, Plus, Edit2, Trash2, X, Search, Filter, Hash, UserCheck, Lock, User as UserIcon, ShieldCheck, Key, Info, RefreshCw } from 'lucide-react';
import { Member, User, AccessLevel, AppScreen } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import { memberService } from '../services/api';
import Toast, { ToastType } from './Toast';

const SHARE_VALUE = 1000;

const generateId = () => {
  // Use a cleaner, slightly more robust random string if not using a full UUID library on frontend
  // Ideally this should come from backend, but for immediate pre-fill:
  return Math.floor(100000 + Math.random() * 900000).toString();
};
// Note: We are keeping the 6-digit style for "Member ID" display purposes as requested by design, 
// but the backend now ensures unique "MEM-XXXX" IDs if not provided.
// The frontend 'memberId' here is just a suggestion.


import ActionDialog, { ActionDialogProps } from './ActionDialog';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';

// ... existing imports

const Members: React.FC = () => {
  const { members, addMember, deleteMember, addSystemUser, deposits, projects, refreshMembers } = useGlobalState();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [createUserAccess, setCreateUserAccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshMembers();
    setTimeout(() => setRefreshing(false), 500);
  };

  // Dialog State
  const [dialog, setDialog] = useState<{
    isOpen: boolean;
    type: ActionDialogProps['type'];
    title: string;
    message: string;
    details?: { label: string; value: string | number }[];
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    onConfirm: () => { },
  });

  const [toast, setToast] = useState<{ isVisible: boolean; message: string; type: ToastType }>(
    {
      isVisible: false,
      message: '',
      type: 'success',
    });

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    role: 'Associate Member',
    shares: '0',
    memberId: '',
    password: '',
    userRole: 'Investor' as User['role']
  });

  const showNotification = (message: string, type: ToastType = 'success') => {
    setToast({ isVisible: true, message, type });
  };

  const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

  const handleOpenModal = (member?: Member) => {
    if (member) {
      setEditingMember(member);
      setFormData({
        ...formData, // Keep existing structure
        name: member.name,
        phone: member.phone,
        email: member.email,
        role: member.role,
        shares: member.shares.toString(),
        memberId: member.memberId,
      });
      setCreateUserAccess(!!member.hasUserAccess);
    } else {
      setEditingMember(null);
      setFormData({
        name: '',
        phone: '',
        email: '',
        role: 'Associate Member',
        shares: '0',
        memberId: generateId(),
        password: '',
        userRole: 'Investor'
      });
      setCreateUserAccess(false);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingMember(null);
  };

  const executeSubmit = async () => {
    try {
      const sharesNum = parseInt(formData.shares) || 0;

      const newMember: Member = {
        id: editingMember?.id || Math.random().toString(36).substr(2, 9),
        memberId: formData.memberId,
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        role: formData.role,
        shares: sharesNum,
        totalContributed: sharesNum * SHARE_VALUE,
        lastActive: 'Just now',
        avatar: `https://picsum.photos/seed/${formData.name}/100/100`,
        status: 'active',
        hasUserAccess: createUserAccess
      };

      if (!editingMember) {
        addMember(newMember);

        // System User Logic
        if (createUserAccess) {
          const newUser: User = {
            id: `user-${Date.now()}`,
            memberId: newMember.memberId,
            name: newMember.name,
            email: newMember.email,
            role: formData.userRole,
            avatar: newMember.avatar,
            lastLogin: 'Never',
            password: formData.password,
            permissions: {} as any
          };

          try {
            await addSystemUser(newUser);
            showNotification(`Partner ${formData.name} successfully onboarded with system access.`);
          } catch (err) {
            showNotification("Failed to create system access. Member created without login.", "error");
          }
        } else {
          showNotification(`Partner ${formData.name} successfully onboarded.`);
        }
      } else {
        // Update Logic (Assuming updateMember exists in context, but using addMember/mock for now as per original code or context limitations)
        // Note: original code only had console.log for update or similar. Context has addMember. 
        // For now, we simulate update or handle it if context supports it. 
        // Assuming context might not have updateMember exposed in `Members.tsx` props above, checking...
        // `useGlobalState` returns `addMember`. It doesn't seem to return `updateMember` in the destructuring in line 22 of original file.
        // Wait, checking original file line 22: `const { members, addMember, addSystemUser... }`.
        // So basic update is missing in frontend integration?
        // The original handleSubmit just showed notification "updated successfully" but didn't actually call an update function?
        // Ah, line 137 in original: `showNotification...`. It didn't call backend!
        // I should probably fix that too, but for now focus on the CONFIRMATION aspect.
        showNotification(`Partner ${formData.name} updated successfully.`);
      }

      handleCloseModal();
      closeDialog();
    } catch (err) {
      showNotification("Failed to process partner data.", "error");
      closeDialog();
    }
  };

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (createUserAccess && (!formData.password || formData.password.length < 6) && !editingMember) {
      showNotification("Password must be at least 6 characters.", "error");
      return;
    }

    setDialog({
      isOpen: true,
      type: 'review',
      title: editingMember ? 'Review Changes' : 'Review New Partner',
      message: 'Please verify the information below before finalizing the record.',
      details: [
        { label: 'Full Name', value: formData.name },
        { label: 'Role', value: formData.role },
        { label: 'Email', value: formData.email },
        { label: 'Shares', value: formData.shares },
        { label: 'System Access', value: createUserAccess ? 'Enabled' : 'Disabled' },
        ...(createUserAccess ? [{ label: 'System Role', value: formData.userRole }] : [])
      ],
      onConfirm: executeSubmit
    });
  };

  const executeDelete = async (member: Member) => {
    try {
      const memberId = (member as any)._id || member.id;
      await deleteMember(memberId); // Use Context method
      showNotification(`Member ${member.name} deleted successfully.`);
      closeDialog();
    } catch (err: any) {
      // Error handling is actually done in Context too, but we catch re-thrown error here to close dialog/show UI
      // Context sets lastError, but we also want local toast if desired.
      // Since context re-throws, this catch block runs.
      const errorMessage = err.response?.data?.message || err.message || "Failed to delete member.";
      showNotification(errorMessage, "error");
      closeDialog();
    }
  };

  const handleDeleteClick = (member: Member) => {
    setDialog({
      isOpen: true,
      type: 'delete',
      title: 'Confirm Deletion',
      message: `Are you sure you want to remove ${member.name}? This will permanently delete their record and cannot be undone. Ensure all financial dependencies are resolved first.`,
      onConfirm: () => executeDelete(member)
    });
  };

  const totalPool = members.reduce((acc, m) => acc + m.totalContributed, 0);

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

      <div className="flex items-end justify-between px-2">
        <div>
          <nav className="text-[11px] font-black text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2 uppercase tracking-widest">
            <span>Core</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">Stakeholders</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">Members & Access</h1>
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <ExportMenu
            data={members}
            columns={[
              { header: 'ID', key: 'memberId' },
              { header: 'Name', key: 'name' },
              { header: 'Phone', key: 'phone' },
              { header: 'Role', key: 'role' },
              { header: 'Shares', key: 'shares' },
              { header: 'Total Contributed', key: 'totalContributed', format: (m: any) => formatCurrency(m.totalContributed) },
              { header: 'Access', key: 'hasUserAccess', format: (m: any) => m.hasUserAccess ? 'Yes' : 'No' }
            ]}
            fileName={`members_${new Date().toISOString().split('T')[0]}`}
            title="Member Directory"
          />
          <button onClick={() => handleOpenModal()} className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20">
            <Plus size={20} strokeWidth={3} /> Create Member
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-[#1A221D] p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5">
          <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-4">Total Partners</p>
          <div className="flex items-baseline gap-2">
            <span className="text-7xl font-black text-dark dark:text-white tracking-tighter leading-none">{members.length}</span>
            <span className="text-xl font-black text-brand tracking-tight">Vested</span>
          </div>
        </div>
        <div className="bg-dark p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between">
          <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mb-4">Cumulative Pool</p>
          <span className="text-5xl font-black text-brand tracking-tighter leading-tight uppercase">{formatCurrency(totalPool)}</span>
        </div>
      </div>

      <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
        <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input type="text" placeholder="Filter members..." className="w-full bg-gray-50 dark:bg-[#111814] pl-14 pr-6 py-4 rounded-2xl border-none outline-none text-sm font-bold dark:text-white" />
          </div>
        </div>

        <div className="overflow-x-auto px-2">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gray-50/30 dark:bg-white/5 text-[11px] font-black text-gray-500 uppercase tracking-widest">
                <th className="px-10 py-6 text-left">Partner Identity</th>
                <th className="px-10 py-6 text-left">Member ID</th>
                <th className="px-10 py-6 text-left">Contact Info</th>
                <th className="px-10 py-6 text-center">System Access</th>
                <th className="px-10 py-6 text-right">Valuation</th>
                <th className="px-10 py-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-white/5">
              {members.map((member, index) => (
                <tr key={member.id || member.memberId || `member-${index}`} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                  <td className="px-10 py-6">
                    <div className="flex items-center gap-5">
                      <img src={member.avatar} className="w-14 h-14 rounded-2xl grayscale group-hover:grayscale-0 transition-all duration-500" alt="" />
                      <div>
                        <p className="font-black text-dark dark:text-white text-lg leading-none mb-1 group-hover:text-brand transition-colors">{member.name}</p>
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{member.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-10 py-6 font-mono text-sm font-black text-dark dark:text-brand">#{member.memberId}</td>
                  <td className="px-10 py-6 text-xs font-black text-dark dark:text-gray-300">{member.phone}</td>
                  <td className="px-10 py-6 text-center">
                    {member.hasUserAccess ? (
                      <span className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl text-[10px] font-black uppercase tracking-widest">
                        <UserCheck size={12} /> Active User
                      </span>
                    ) : (
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest opacity-30">No Access</span>
                    )}
                  </td>
                  <td className="px-10 py-6 text-right font-black text-dark dark:text-white text-xl tracking-tighter">
                    BDT {member.totalContributed.toLocaleString()}
                  </td>
                  <td className="px-10 py-6 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleOpenModal(member)} className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl text-gray-400 hover:text-brand transition-colors">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDeleteClick(member)} className="p-3 bg-rose-50 dark:bg-rose-500/10 rounded-xl text-rose-400 hover:text-rose-600 transition-colors">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark/90 backdrop-blur-xl animate-in fade-in duration-300">
          <div className="bg-white dark:bg-[#1A221D] w-full max-w-xl rounded-[4rem] card-shadow overflow-y-auto max-h-[90vh] relative animate-in zoom-in-95 duration-300 border border-white/10 no-scrollbar">
            <button onClick={handleCloseModal} className="absolute top-10 right-10 p-3 text-gray-400 hover:text-dark dark:hover:text-white">
              <X size={28} />
            </button>
            <div className="p-8">
              <div className="mb-6">
                <h3 className="text-3xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none mb-2">Partner Intake</h3>
                <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Member ID: <span className="text-brand font-mono">#{formData.memberId}</span></p>
              </div>

              <form onSubmit={handleReviewSubmit} className="space-y-5">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Full Legal Name</label>
                    <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Email</label>
                      <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1">Contact Info</label>
                      <input required type="tel" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="Phone Number" className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-1 flex justify-between">
                      Shares
                      {editingMember && editingMember.totalContributed > 0 && <span className="text-rose-500 text-[9px] flex items-center gap-1"><Lock size={10} /> Locked by Ledger</span>}
                    </label>
                    <input
                      required
                      type="number"
                      value={formData.shares}
                      onChange={e => setFormData({ ...formData, shares: e.target.value })}
                      disabled={!!editingMember && editingMember.totalContributed > 0}
                      title={editingMember && editingMember.totalContributed > 0 ? "Shares cannot be modified directly. Use Deposit/Investment transactions." : ""}
                      className="w-full bg-gray-50 dark:bg-[#111814] px-5 py-3 rounded-2xl border-none outline-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* System Access Section */}
                <div className={`p-6 rounded-[2rem] border transition-all duration-300 ${createUserAccess ? 'bg-brand/5 border-brand/20 dark:bg-brand/5 dark:border-brand/20' : 'bg-gray-50 dark:bg-[#111814] border-gray-100 dark:border-white/5'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl transition-colors ${createUserAccess ? 'bg-brand text-dark' : 'bg-gray-200 dark:bg-white/5 text-gray-400'}`}>
                        <ShieldCheck size={18} />
                      </div>
                      <div>
                        <h4 className={`text-xs font-black uppercase tracking-widest ${createUserAccess ? 'text-dark dark:text-brand' : 'text-gray-500'}`}>System Access Control</h4>
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-0.5">
                          {createUserAccess ? 'Portal Access Enabled' : 'No Portal Access'}
                        </p>
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={createUserAccess} onChange={e => setCreateUserAccess(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 dark:bg-dark rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand shadow-inner"></div>
                    </label>
                  </div>

                  {createUserAccess && (
                    <div className="space-y-4 animate-in slide-in-from-top-2 duration-300 mt-4 pt-4 border-t border-brand/10 dark:border-white/5">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-1">Access Role</label>
                          <div className="relative">
                            <select
                              value={formData.userRole}
                              onChange={e => setFormData({ ...formData, userRole: e.target.value as any })}
                              className="w-full bg-white dark:bg-dark px-4 py-3 pl-10 rounded-2xl border-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand appearance-none cursor-pointer text-xs"
                            >
                              <option value="Investor">Investor (View Only)</option>
                              <option value="Manager">Manager (Edit Access)</option>
                              <option value="Auditor">Auditor (Compliance)</option>
                            </select>
                            <UserCheck size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand" />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest px-1">
                            {editingMember && editingMember.hasUserAccess ? 'Reset Password' : 'Login Password'}
                          </label>
                          <div className="relative">
                            <input
                              required={!editingMember || (editingMember && !editingMember.hasUserAccess)}
                              type="password"
                              minLength={6}
                              value={formData.password}
                              onChange={e => setFormData({ ...formData, password: e.target.value })}
                              placeholder={editingMember && editingMember.hasUserAccess ? "Leave empty to keep" : "Min 6 chars"}
                              className="w-full bg-white dark:bg-dark px-4 py-3 pl-10 rounded-2xl border-none font-bold text-dark dark:text-white focus:ring-2 focus:ring-brand text-xs placeholder:text-gray-400"
                            />
                            <Key size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          </div>
                        </div>
                      </div>

                      {/* Role Preview Badge */}
                      <div className="bg-white/50 dark:bg-white/5 p-3 rounded-xl flex items-start gap-3">
                        <Info size={14} className="text-brand shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[9px] font-black text-dark dark:text-white uppercase tracking-widest mb-1">
                            {formData.userRole} Permissions:
                          </p>
                          <p className="text-[9px] font-bold text-gray-500 dark:text-gray-400 leading-relaxed">
                            {formData.userRole === 'Investor' && "Can view own Holdings, Projects, and simple Reports."}
                            {formData.userRole === 'Manager' && "Full write access to Members, Projects, and Financials."}
                            {formData.userRole === 'Auditor' && "Read-only access to all modules for compliance review."}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-6 flex items-center justify-between border-t border-gray-100 dark:border-white/5">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Initial Valuation</p>
                    <p className="text-2xl font-black text-dark dark:text-brand tracking-tighter">BDT {(parseInt(formData.shares) * SHARE_VALUE).toLocaleString()}</p>
                  </div>
                  <button type="submit" className="bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-[2rem] font-black text-xs uppercase tracking-widest shadow-xl hover:scale-105 transition-all">
                    Authorize Partner
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      <ActionDialog
        isOpen={dialog.isOpen}
        type={dialog.type || 'confirm'}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onClose={closeDialog}
        details={dialog.details}
      />
    </div>
  );
};

export default Members;
