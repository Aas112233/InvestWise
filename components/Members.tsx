
import React, { useState } from 'react';
import { Mail, Phone, MoreVertical, Plus, Edit2, Trash2, X, Search, Filter, Hash, UserCheck, Lock, User as UserIcon, ShieldCheck, Key, Info, RefreshCw } from 'lucide-react';
import { Member, User, AccessLevel, AppScreen } from '../types';
import { useGlobalState } from '../context/GlobalStateContext';
import { memberService } from '../services/api';
import Toast, { ToastType } from './Toast';
import { Language, t } from '../i18n/translations';
import SearchBar from './SearchBar';
import Pagination from './Pagination';
import ActionDialog, { ActionDialogProps } from './ActionDialog';
import ExportMenu from './ExportMenu';
import { formatCurrency } from '../utils/formatters';
import Avatar from './Avatar';
import { ModalForm, FormInput, FormSelect, FormLabel } from './ui/FormElements';
import PermissionGuard from './PermissionGuard';

const SHARE_VALUE = 1000;

const generateId = () => {
  // Use a cleaner, slightly more robust random string if not using a full UUID library on frontend
  // Ideally this should come from backend, but for immediate pre-fill:
  return Math.floor(100000 + Math.random() * 900000).toString();
};

interface MembersProps {
  lang: Language;
}

const Members: React.FC<MembersProps> = ({ lang }) => {
  const { members, addMember, updateMember, deleteMember, addSystemUser, systemUsers, refreshMembers, currentUser } = useGlobalState();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [createUserAccess, setCreateUserAccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [paginatedMembers, setPaginatedMembers] = useState<{
    data: Member[];
    total: number;
    pages: number;
  }>({ data: [], total: 0, pages: 0 });
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchPaginatedMembers = async (page: number, search: string, limit: number) => {
    setLoading(true);
    try {
      const result = await memberService.getAll({ page, limit, search });
      setPaginatedMembers({
        data: result.data.map((m: any) => ({ ...m, id: m._id || m.id })),
        total: result.total,
        pages: result.pages
      });
    } catch (err) {
      console.error('Failed to fetch paginated members:', err);
      showNotification(t('members.processError', lang), 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage);
  }, [currentPage, searchQuery, rowsPerPage]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage);
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
      const linkedUser = systemUsers.find(u => u.memberId === member.memberId);

      setFormData({
        ...formData,
        name: member.name,
        phone: member.phone,
        email: member.email,
        role: member.role,
        shares: member.shares.toString(),
        memberId: member.memberId,
        userRole: linkedUser?.role || 'Investor',
        password: ''
      });
      setCreateUserAccess(!!member.hasUserAccess || !!linkedUser);
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
    setCreateUserAccess(false);
    setFormData({
      name: '',
      phone: '',
      email: '',
      role: 'Associate Member',
      shares: '0',
      memberId: '',
      password: '',
      userRole: 'Investor'
    });
  };

  const createSystemAccess = async (member: Member) => {
    const newUser: User = {
      id: `user-${Date.now()}`,
      memberId: member.memberId,
      name: member.name,
      email: member.email,
      role: formData.userRole,
      avatar: member.avatar,
      lastLogin: 'Never',
      password: formData.password,
      permissions: {} as any
    };

    try {
      await addSystemUser(newUser);
      await createSystemAccess(member);
      showNotification(t('members.onboardedAccess', lang).replace('{name}', member.name));
    } catch (err: any) {
      showNotification(t('members.portalProvisionError', lang).replace('{error}', err.message), "error");
    }
  };

  const executeSubmit = async () => {
    setIsSubmitting(true);
    try {
      const sharesNum = parseInt(formData.shares) || 0;

      const newMember: Member = {
        id: editingMember?.id || Math.random().toString(36).substr(2, 9),
        memberId: formData.memberId,
        name: formData.name,
        phone: formData.phone,
        email: formData.email,
        role: formData.role,
        shares: editingMember ? editingMember.shares : sharesNum,
        totalContributed: editingMember ? editingMember.totalContributed : (sharesNum * SHARE_VALUE),
        lastActive: 'Just now',
        avatar: '', // Letter avatars are generated from name on-the-fly
        status: 'active',
        hasUserAccess: createUserAccess
      };

      if (!editingMember) {
        await addMember(newMember);

        if (createUserAccess) {
          await createSystemAccess(newMember);
        } else {
          showNotification(t('members.onboarded', lang).replace('{name}', formData.name));
        }
      } else {
        await updateMember(newMember);

        if (createUserAccess && !editingMember.hasUserAccess) {
          await createSystemAccess(newMember);
        } else {
          showNotification(t('members.updated', lang).replace('{name}', formData.name));
        }
      }

      handleCloseModal();
      closeDialog();
      fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage);
    } catch (err: any) {
      showNotification(err.message || t('members.processError', lang), "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (createUserAccess && (!formData.password || formData.password.length < 6) && !editingMember) {
      showNotification(t('members.passwordLengthError', lang), "error");
      return;
    }

    setDialog({
      isOpen: true,
      type: 'review',
      title: editingMember ? t('members.reviewTitle', lang) : t('members.reviewTitle', lang),
      message: t('members.reviewMessage', lang),
      details: [
        { label: t('members.legalName', lang), value: formData.name },
        { label: t('members.memberId', lang), value: formData.memberId },
        { label: t('members.accessRole', lang), value: formData.role },
        { label: t('members.valuation', lang), value: `BDT ${formData.shares}` },
        { label: t('members.systemAccess', lang), value: createUserAccess ? t('common.active', lang) : t('common.pending', lang) },
      ],
      onConfirm: executeSubmit
    });
  };

  const executeDelete = async (member: Member) => {
    setIsSubmitting(true);
    try {
      const memberId = (member as any)._id || member.id;
      await deleteMember(memberId); // Use Context method
      showNotification(t('members.deleteSuccess', lang).replace('{name}', member.name));
      closeDialog();
      fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage);
    } catch (err: any) {
      // Error handling is actually done in Context too, but we catch re-thrown error here to close dialog/show UI
      // Context sets lastError, but we also want local toast if desired.
      // since context re-throws, this catch block runs.
      const errorMessage = err.response?.data?.message || err.message || t('members.deleteError', lang);
      showNotification(errorMessage, "error");
      closeDialog();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (member: Member) => {
    setDialog({
      isOpen: true,
      type: 'delete',
      title: t('members.deleteConfirm', lang),
      message: t('members.deleteMessage', lang).replace('{name}', member.name),
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
            <span>{t('nav.management', lang)}</span>
            <span className="opacity-30">/</span>
            <span className="text-brand">{t('members.stakeholders', lang)}</span>
          </nav>
          <div className="flex items-center gap-4">
            <h1 className="text-4xl font-black text-dark dark:text-white uppercase tracking-tighter leading-none">{t('nav.members', lang)}</h1>
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
              { header: t('members.memberId', lang), key: 'memberId' },
              { header: t('members.name', lang), key: 'name' },
              { header: t('members.phone', lang), key: 'phone' },
              { header: t('members.role', lang), key: 'role' },
              { header: t('members.shares', lang), key: 'shares' },
              { header: `${t('members.totalContribution', lang)} (BDT)`, key: 'totalContributed', format: (m: any) => m.totalContributed.toLocaleString() },
              { header: t('members.access', lang), key: 'hasUserAccess', format: (m: any) => m.hasUserAccess ? (lang === 'bn' ? 'হ্যাঁ' : 'Yes') : (lang === 'bn' ? 'না' : 'No') }
            ]}
            fileName={`members_${new Date().toISOString().split('T')[0]}`}
            title="Stakeholder Register"
            lang={lang}
            targetId="members-snapshot-target"
          />
          <PermissionGuard screen={AppScreen.MEMBERS} requiredLevel={AccessLevel.WRITE}>
            <button
              onClick={() => handleOpenModal()}
              className="bg-dark dark:bg-brand text-white dark:text-dark px-8 py-4 rounded-[2rem] font-black text-[11px] uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-xl shadow-brand/10"
            >
              <Plus size={18} />
              <span>{t('common.add', lang)}</span>
            </button>
          </PermissionGuard>
        </div>
      </div>
      <div id="members-snapshot-target" className="space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-white dark:bg-[#1A221D] p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between border border-gray-100 dark:border-white/5">
            <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest mb-4">{t('members.totalPartners', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-4xl sm:text-5xl lg:text-7xl font-black text-dark dark:text-white tracking-tighter leading-none">{paginatedMembers.total}</span>
              <span className="text-xl font-black text-brand tracking-tight">{t('members.vested', lang)}</span>
            </div>
          </div>
          <div className="bg-dark p-8 lg:p-10 rounded-[3.5rem] card-shadow flex flex-col justify-between">
            <p className="text-[11px] font-black text-white/30 uppercase tracking-widest mb-4">{t('members.cumulativePool', lang)}</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`font-black text-brand tracking-tighter leading-tight uppercase ${formatCurrency(totalPool).length > 12 ? 'text-3xl sm:text-4xl' : 'text-4xl sm:text-5xl'}`}>{formatCurrency(totalPool)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1A221D] rounded-[3.5rem] card-shadow overflow-hidden border border-gray-100 dark:border-white/5">
          <div className="px-10 py-8 border-b border-gray-50 dark:border-white/5 flex items-center justify-between gap-6">
            <SearchBar
              onSearch={(q) => {
                setSearchQuery(q);
                setCurrentPage(1);
              }}
              placeholder={t('members.filterPlaceholder', lang)}
            />
          </div>

          <div className="overflow-x-auto px-2">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50/30 dark:bg-white/5 text-[11px] font-black text-gray-500 uppercase tracking-widest">
                  <th className="px-10 py-6 text-left">{t('members.partnerIdentity', lang)}</th>
                  <th className="px-10 py-6 text-left">{t('members.memberId', lang)}</th>
                  <th className="px-10 py-6 text-left">{t('members.contactInfo', lang)}</th>
                  <th className="px-10 py-6 text-center">{t('members.systemAccess', lang)}</th>
                  <th className="px-10 py-6 text-center">{t('members.shares', lang)}</th>
                  <th className="px-10 py-6 text-right">{t('members.valuation', lang)}</th>
                  <th className="px-10 py-6 text-right">{t('members.action', lang)}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-10 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="animate-spin text-brand" size={40} />
                        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Scanning Ledger...</p>
                      </div>
                    </td>
                  </tr>
                ) : paginatedMembers.data.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-10 py-20 text-center">
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest">No stakeholders found matching your search</p>
                    </td>
                  </tr>
                ) : (
                  paginatedMembers.data.map((member, index) => (
                    <tr key={member.id || member.memberId || `member-${index}`} className="hover:bg-gray-50/50 dark:hover:bg-white/10 transition-all group">
                      <td className="px-10 py-6">
                        <div className="flex items-center gap-5">
                          <Avatar name={member.name} size="lg" className="grayscale group-hover:grayscale-0" />
                          <div>
                            <p className="font-black text-dark dark:text-white text-lg leading-none mb-1 group-hover:text-brand transition-colors">{member.name}</p>
                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{member.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-10 py-6 font-mono text-sm font-black text-dark dark:text-brand">#{member.memberId}</td>
                      <td className="px-10 py-6 text-xs font-black text-dark dark:text-gray-300">{member.phone}</td>
                      <td className="px-10 py-6 text-center">
                        {(member.hasUserAccess || systemUsers.some(u => u.memberId === member.memberId)) ? (
                          <span className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-500 rounded-xl text-[10px] font-black uppercase tracking-widest border border-emerald-500/20 shadow-sm shadow-emerald-500/5 transition-all hover:scale-105">
                            <ShieldCheck size={12} strokeWidth={3} /> {t('common.authorizedBadge', lang)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2 px-4 py-2 bg-gray-500/5 text-gray-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-gray-500/10 opacity-40 transition-all hover:opacity-60">
                            <Lock size={12} /> {t('common.restrictedBadge', lang)}
                          </span>
                        )}
                      </td>
                      <td className="px-10 py-6 text-center">
                        <span className="font-black text-dark dark:text-brand text-lg">{member.shares}</span>
                      </td>
                      <td className="px-10 py-6 text-right font-black text-dark dark:text-white text-xl tracking-tighter">
                        BDT {member.totalContributed.toLocaleString()}
                      </td>
                      <td className="px-10 py-6 text-right">
                        <PermissionGuard screen={AppScreen.MEMBERS} requiredLevel={AccessLevel.WRITE}>
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => handleOpenModal(member)} className="p-3 bg-gray-50 dark:bg-white/5 rounded-xl text-gray-400 hover:text-brand transition-colors">
                              <Edit2 size={18} />
                            </button>
                            <button onClick={() => handleDeleteClick(member)} className="p-3 bg-rose-50 dark:bg-rose-500/10 rounded-xl text-rose-400 hover:text-rose-600 transition-colors">
                              <Trash2 size={18} />
                            </button>
                          </div>
                        </PermissionGuard>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="px-10 py-8 border-t border-gray-50 dark:border-white/5">
            <Pagination
              currentPage={currentPage}
              totalPages={paginatedMembers.pages}
              onPageChange={setCurrentPage}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(newLimit) => {
                setRowsPerPage(newLimit);
                setCurrentPage(1);
              }}
            />
          </div>
        </div>
      </div>

      <ModalForm
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        title={t('members.intake', lang)}
        subtitle={`${t('members.memberId', lang)}: #${formData.memberId}`}
        onSubmit={handleReviewSubmit}
        submitLabel="Authorize Partner"
        maxWidth="max-w-6xl"
        loading={isSubmitting}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <FormInput
              label={t('members.legalName', lang)}
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <FormInput
              label={t('auth.identifier', lang)}
              type="email"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              required
            />
            <FormInput
              label={t('members.contactInfo', lang)}
              type="tel"
              placeholder="Phone Number"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              required
            />
          </div>

          <FormInput
            label={t('members.shares', lang)} // Simplified label, will handle extra info below if needed
            type="number"
            value={formData.shares}
            onChange={e => setFormData({ ...formData, shares: e.target.value })}
            required
            disabled={!!editingMember && editingMember.totalContributed > 0}
            title={editingMember && editingMember.totalContributed > 0 ? "Shares cannot be modified directly. Use Deposit/Investment transactions." : ""}
            className={!!editingMember && editingMember.totalContributed > 0 ? "opacity-70" : ""}
          />
          {editingMember && editingMember.totalContributed > 0 &&
            <p className="text-[10px] font-bold text-rose-500 flex items-center gap-1 mt-1">
              <Lock size={10} /> Locked by Ledger
            </p>
          }

          {/* System Access Section */}
          <div className={`p-6 rounded-[2rem] border transition-all duration-300 ${createUserAccess ? 'bg-brand/5 border-brand/20 dark:bg-brand/5 dark:border-brand/20' : 'bg-gray-50 dark:bg-[#111814] border-gray-100 dark:border-white/5'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl transition-colors ${createUserAccess ? 'bg-brand text-dark' : 'bg-gray-200 dark:bg-white/5 text-gray-400'}`}>
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h4 className={`text-xs font-black uppercase tracking-widest ${createUserAccess ? 'text-dark dark:text-brand' : 'text-gray-500'}`}>{t('members.systemAccessControl', lang)}</h4>
                  <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                    {systemUsers.some(u => u.memberId === formData.memberId) ? t('members.portalActive', lang) : createUserAccess ? t('members.portalEnabled', lang) : t('members.noPortal', lang)}
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" checked={createUserAccess} onChange={e => setCreateUserAccess(e.target.checked)} className="sr-only peer" />
                <div className="w-11 h-6 bg-gray-200 dark:bg-dark rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand shadow-inner"></div>
              </label>
            </div>

            {createUserAccess && (
              <div className="space-y-4 animate-in slide-in-from-top-2 duration-300 pt-4 border-t border-brand/10 dark:border-white/5">
                <div className="grid grid-cols-2 gap-6">
                  <FormSelect
                    label="Access Role"
                    value={formData.userRole}
                    onChange={e => setFormData({ ...formData, userRole: e.target.value as any })}
                    options={[
                      { value: "Investor", label: "Investor (View Only)" },
                      { value: "Manager", label: "Manager (Edit Access)" },
                      { value: "Auditor", label: "Auditor (Compliance)" }
                    ]}
                    icon={<UserCheck size={14} className="text-brand" />}
                  />
                  <FormInput
                    label={systemUsers.some(u => u.memberId === formData.memberId) ? 'Reset Password' : 'Login Password'}
                    type="password"
                    minLength={6}
                    required={!systemUsers.some(u => u.memberId === formData.memberId)}
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    placeholder={systemUsers.some(u => u.memberId === formData.memberId) ? "Leave empty to keep" : "Min 6 chars"}
                    icon={<Key size={14} />}
                  />
                </div>

                <div className="bg-white/50 dark:bg-white/5 p-4 rounded-2xl flex items-start gap-3">
                  <Info size={16} className="text-brand shrink-0 mt-0.5" />
                  <div>
                    <p className="text-[10px] font-black text-dark dark:text-white uppercase tracking-widest mb-1">
                      {formData.userRole} Permissions:
                    </p>
                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 leading-relaxed">
                      {formData.userRole === 'Investor' && t('members.investorDesc', lang)}
                      {formData.userRole === 'Manager' && t('members.managerDesc', lang)}
                      {formData.userRole === 'Auditor' && t('members.auditorDesc', lang)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-white/5 rounded-3xl">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Initial Valuation</p>
            <p className="text-2xl font-black text-dark dark:text-brand tracking-tighter">BDT {(parseInt(formData.shares) * SHARE_VALUE).toLocaleString()}</p>
          </div>
        </div>
      </ModalForm>

      <ActionDialog
        isOpen={dialog.isOpen}
        type={dialog.type || 'confirm'}
        title={dialog.title}
        message={dialog.message}
        onConfirm={dialog.onConfirm}
        onClose={closeDialog}
        details={dialog.details}
        loading={isSubmitting}
      />
    </div>
  );

};

export default Members;
