
import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, Phone, MoreVertical, Plus, Edit2, Trash2, X, Search, Filter, Hash, UserCheck, Lock, User as UserIcon, ShieldCheck, Key, Info, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Member, User, AccessLevel, AppScreen } from '../types';
import { Table, TableColumn } from './ui/Table';
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
import { memberSchema, MemberFormData } from '../utils/validations';
import SummaryMetricCard from './SummaryMetricCard';

const SHARE_VALUE = 1000;

// Member ID is now handled by server-side sequential logic or explicit user input.
// Initial pre-fill can be empty or a simple placeholder.

interface MembersProps {
    lang: Language;
}

const Members: React.FC<MembersProps> = ({ lang }) => {
    const { members, addMember, updateMember, deleteMember, addSystemUser, onboardMember, systemUsers, refreshMembers, currentUser, updateUserPassword, currencyCode } = useGlobalState();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<Member | null>(null);
    const [createUserAccess, setCreateUserAccess] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [sortBy, setSortBy] = useState('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const [paginatedMembers, setPaginatedMembers] = useState<{
        data: Member[];
        total: number;
        pages: number;
        meta?: any;
    }>({ data: [], total: 0, pages: 0 });
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchPaginatedMembers = async (page: number, search: string, limit: number, sort: string, order: 'asc' | 'desc') => {
        setLoading(true);
        try {
            const response = await memberService.getAll({ page, limit, search, sortBy: sort, sortOrder: order });
            setPaginatedMembers({
                data: response.data.map((m: any) => ({ ...m, id: m._id || m.id })),
                total: response.meta.total,
                pages: response.meta.pages,
                meta: response.meta
            });
        } catch (err) {
            console.error('Failed to fetch paginated members:', err);
            showNotification(t('members.processError', lang), 'error');
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => {
        fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage, sortBy, sortOrder);
    }, [currentPage, searchQuery, rowsPerPage, sortBy, sortOrder]);

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
        setCurrentPage(1);
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        await fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage, sortBy, sortOrder);
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

    // React Hook Form setup
    const {
        register,
        handleSubmit,
        formState: { errors, isValid, isSubmitting: isFormSubmitting },
        reset,
        setValue,
        watch,
        setError: setFieldError,
        clearErrors
    } = useForm<MemberFormData>({
        resolver: zodResolver(memberSchema),
        mode: 'onChange',
        reValidateMode: 'onChange',
        defaultValues: {
            name: '',
            phone: '',
            email: '',
            role: 'Associate Member',
            shares: 0,
            memberId: '',
            password: '',
            userRole: 'Investor',
            createUserAccess: false
        }
    });

    // Watch form values for dynamic UI
    const watchedShares = watch('shares');
    const watchedCreateUserAccess = watch('createUserAccess');
    const watchedUserRole = watch('userRole');
    const watchedPassword = watch('password');
    const watchedMemberId = watch('memberId');

    const showNotification = (message: string, type: ToastType = 'success') => {
        setToast({ isVisible: true, message, type });
    };

    const closeDialog = () => setDialog(prev => ({ ...prev, isOpen: false }));

    const handleOpenModal = (member?: Member) => {
        if (member) {
            setEditingMember(member);
            const linkedUser = systemUsers.find(u => u.memberId === member.memberId);

            // Reset form with member data
            reset({
                name: member.name,
                phone: member.phone,
                email: member.email,
                role: member.role,
                shares: member.shares,
                memberId: member.memberId,
                userRole: linkedUser?.role || 'Investor',
                password: '',
                createUserAccess: !!member.hasUserAccess || !!linkedUser
            });
            setCreateUserAccess(!!member.hasUserAccess || !!linkedUser);
        } else {
            setEditingMember(null);
            // Reset form with default values
            reset({
                name: '',
                phone: '',
                email: '',
                role: 'Associate Member',
                shares: 0,
                memberId: '',
                password: '',
                userRole: 'Investor',
                createUserAccess: false
            });
            setCreateUserAccess(false);
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingMember(null);
        setCreateUserAccess(false);
        reset({
            name: '',
            phone: '',
            email: '',
            role: 'Associate Member',
            shares: 0,
            memberId: '',
            password: '',
            userRole: 'Investor',
            createUserAccess: false
        });
        clearErrors();
    };

    // Onboarding is now handled via unified onboardMember backend logic.
    // This legacy function is removed for atomicity.

    const executeSubmit = async (data: MemberFormData) => {
        setIsSubmitting(true);
        try {
            if (!editingMember) {
                // Unified Onboarding (Enterprise Grade)
                await onboardMember({
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    role: data.role,
                    shares: data.shares,
                    systemAccess: data.createUserAccess,
                    password: data.password,
                    userRole: data.userRole,
                    status: 'active'
                });
                showNotification(
                    data.createUserAccess
                        ? t('members.onboardedAccess', lang).replace('{name}', data.name)
                        : t('members.onboarded', lang).replace('{name}', data.name)
                );
            } else {
                // Standard Update (Profile Only - Financials are immutable here)
                const updatedMember: any = {
                    id: editingMember.id,
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    role: data.role,
                    hasUserAccess: data.createUserAccess
                };
                await updateMember(updatedMember);

                // Handle System Access & Password Update
                const linkedUser = systemUsers.find(u => u.memberId === editingMember.memberId);
                if (data.createUserAccess && data.password && linkedUser) {
                    try {
                        await updateUserPassword(linkedUser.id, data.password);
                    } catch (pwErr) {
                        console.error("Failed to update password during member edit", pwErr);
                        showNotification("Member updated, but password reset failed", "warning");
                    }
                }

                showNotification(t('members.updated', lang).replace('{name}', data.name));
            }

            handleCloseModal();
            closeDialog();
            fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage, sortBy, sortOrder);
        } catch (err: any) {
            const errorMessage = err.response?.data?.message || err.message || t('members.processError', lang);
            showNotification(errorMessage, "error");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleReviewSubmit = (data: MemberFormData) => {
        // Show review dialog before submission
        setDialog({
            isOpen: true,
            type: 'review',
            title: editingMember ? t('members.reviewTitle', lang) : t('members.reviewTitle', lang),
            message: t('members.reviewMessage', lang),
            details: [
                { label: t('members.legalName', lang), value: data.name },
                { label: t('members.memberId', lang), value: data.memberId || 'Auto-generated' },
                { label: t('members.accessRole', lang), value: data.role },
                { label: t('members.valuation', lang), value: `${currencyCode} ${(data.shares * SHARE_VALUE).toLocaleString()}` },
                { label: t('members.systemAccess', lang), value: data.createUserAccess ? t('common.active', lang) : t('common.pending', lang) },
            ],
            onConfirm: () => executeSubmit(data)
        });
    };

    const executeDelete = async (member: Member) => {
        setIsSubmitting(true);
        try {
            const memberId = (member as any)._id || member.id;
            await deleteMember(memberId); // Use Context method
            showNotification(t('members.deleteSuccess', lang).replace('{name}', member.name));
            closeDialog();
            fetchPaginatedMembers(currentPage, searchQuery, rowsPerPage, sortBy, sortOrder);
        } catch (err: any) {
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

    const totalPool = members.reduce((acc, m) => acc + (m.successfulDepositTotal || 0), 0);

    const tableColumns: TableColumn<Member>[] = [
        {
            key: 'name',
            header: t('members.partnerIdentity', lang),
            sortable: true,
            render: (member) => (
                <div className="flex items-center gap-5">
                    <Avatar name={member.name} size="lg" className="grayscale group-hover:grayscale-0" />
                    <div>
                        <p className="font-black text-dark dark:text-white text-lg leading-none mb-1 group-hover:text-brand transition-colors">{member.name}</p>
                        <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{member.role}</p>
                    </div>
                </div>
            )
        },
        {
            key: 'memberId',
            header: t('members.memberId', lang),
            sortable: true,
            cellClassName: 'font-mono text-sm font-black text-dark dark:text-brand',
            render: (member) => `#${member.memberId}`
        },
        {
            key: 'phone',
            header: t('members.contactInfo', lang),
            cellClassName: 'text-xs font-black text-dark dark:text-gray-300',
            render: (member) => member.phone
        },
        {
            key: 'hasUserAccess',
            header: t('members.systemAccess', lang),
            align: 'center',
            render: (member) => (member.hasUserAccess || systemUsers.some(u => u.memberId === member.memberId)) ? (
                <div className="flex justify-center">
                    <span className="flex items-center justify-center w-8 h-8 bg-emerald-500/10 text-emerald-500 rounded-full border border-emerald-500/20 shadow-sm shadow-emerald-500/5 transition-all hover:scale-110" title={t('common.authorizedBadge', lang)}>
                        <CheckCircle2 size={18} strokeWidth={2.5} />
                    </span>
                </div>
            ) : (
                <div className="flex justify-center">
                    <span className="flex items-center justify-center w-8 h-8 bg-gray-500/5 text-gray-400 rounded-full border border-gray-500/10 opacity-40 transition-all hover:opacity-60" title={t('common.restrictedBadge', lang)}>
                        <Lock size={16} strokeWidth={2} />
                    </span>
                </div>
            )
        },
        {
            key: 'shares',
            header: t('members.shares', lang),
            sortable: true,
            align: 'center',
            cellClassName: 'font-black text-dark dark:text-brand text-lg',
            render: (member) => member.shares
        },
        {
            key: 'successfulDepositTotal',
            header: t('members.totalContribution', lang),
            sortable: true,
            align: 'right',
            cellClassName: 'font-black text-dark dark:text-white text-xl tracking-tighter',
            render: (member) => `${currencyCode} ${(member.successfulDepositTotal || 0).toLocaleString()}`
        },
        {
            key: 'actions',
            header: t('members.action', lang),
            align: 'right',
            render: (member) => (
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
            )
        }
    ];

    return (
        <div className="compact-screen space-y-10 animate-in fade-in duration-500">
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
                        <PermissionGuard screen={AppScreen.MEMBERS} requiredLevel={AccessLevel.WRITE}>
                            <button
                                onClick={async () => {
                                    if (confirm(t('members.confirmRecalculate', lang) || "Recalculate all financial data? This may take a moment.")) {
                                        setRefreshing(true);
                                        try {
                                            const res = await memberService.recalculateFinancials();
                                            showNotification(res.message);
                                            await handleRefresh();
                                        } catch (err: any) {
                                            showNotification(err.message || "Recalculation failed", "error");
                                        } finally {
                                            setRefreshing(false);
                                        }
                                    }
                                }}
                                className={`p-2 rounded-full hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-all ${refreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title="Recalculate Financials"
                                disabled={refreshing}
                            >
                                <Hash size={20} />
                            </button>
                        </PermissionGuard>
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
                            { header: `${t('members.totalContribution', lang)} (${currencyCode})`, key: 'successfulDepositTotal', format: (m: any) => (m.successfulDepositTotal || 0).toLocaleString() },
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SummaryMetricCard
                        label={t('members.totalPartners', lang)}
                        value={paginatedMembers.total}
                        note={t('members.vested', lang)}
                    />
                    <SummaryMetricCard
                        label={t('members.cumulativePool', lang)}
                        value={formatCurrency(totalPool)}
                        variant="dark"
                    />
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

                    <Table
                        data={paginatedMembers.data}
                        columns={tableColumns}
                        loading={loading}
                        loadingMessage="Scanning Ledger..."
                        emptyMessage={<p className="text-xs font-black text-gray-400 uppercase tracking-widest">No stakeholders found matching your search</p>}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        rowKey={(member, index) => member.id || member.memberId || `member-${index}`}
                    />

                    <div className="px-10 py-8 border-t border-gray-50 dark:border-white/5 flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            {paginatedMembers.meta && (
                                <>Showing {paginatedMembers.meta.from} to {paginatedMembers.meta.to} of {paginatedMembers.meta.total} stakeholders</>
                            )}
                        </div>
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
                subtitle={`${t('members.memberId', lang)}: #${watchedMemberId || 'Auto'}`}
                onSubmit={handleSubmit((data) => handleReviewSubmit(data as MemberFormData))}
                submitLabel={t('common.save', lang)}
                maxWidth="max-w-6xl"
                loading={isSubmitting || isFormSubmitting}
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <FormInput
                            label={t('members.legalName', lang)}
                            {...register('name')}
                            error={errors.name?.message}
                            required
                        />
                        <FormInput
                            label={t('auth.identifier', lang)}
                            type="email"
                            {...register('email')}
                            error={errors.email?.message}
                            required
                        />
                        <FormInput
                            label={t('members.contactInfo', lang)}
                            type="tel"
                            placeholder="+8801XXXXXXXXX"
                            {...register('phone')}
                            error={errors.phone?.message}
                            required
                        />
                    </div>

                    <FormInput
                        label={t('members.shares', lang)}
                        type="number"
                        {...register('shares', { valueAsNumber: true })}
                        error={errors.shares?.message}
                        required
                    />
                </div>
                {editingMember && editingMember.totalContributed > 0 && (
                    <p className="text-[10px] font-bold text-brand flex items-center gap-1 mt-1">
                        <Lock size={10} /> Shares are managed independently
                    </p>
                )}

                {/* System Access Section */}
                <div className={`p-6 rounded-[2rem] border transition-all duration-300 ${watchedCreateUserAccess ? 'bg-brand/5 border-brand/20 dark:bg-brand/5 dark:border-brand/20' : 'bg-gray-50 dark:bg-[#111814] border-gray-100 dark:border-white/5'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-xl transition-colors ${watchedCreateUserAccess ? 'bg-brand text-dark' : 'bg-gray-200 dark:bg-white/5 text-gray-400'}`}>
                                <ShieldCheck size={20} />
                            </div>
                            <div>
                                <h4 className={`text-xs font-black uppercase tracking-widest ${watchedCreateUserAccess ? 'text-dark dark:text-brand' : 'text-gray-500'}`}>{t('members.systemAccessControl', lang)}</h4>
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest mt-1">
                                    {systemUsers.some(u => u.memberId === watchedMemberId) ? t('members.portalActive', lang) : watchedCreateUserAccess ? t('members.portalEnabled', lang) : t('members.noPortal', lang)}
                                </p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                {...register('createUserAccess')}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 dark:bg-dark rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand shadow-inner"></div>
                        </label>
                    </div>

                    {watchedCreateUserAccess && (
                        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300 pt-4 border-t border-brand/10 dark:border-white/5">
                            <div className="grid grid-cols-2 gap-6">
                                <FormSelect
                                    label="Access Role"
                                    {...register('userRole')}
                                    options={[
                                        { value: "Admin", label: t('members.adminRole', lang) },
                                        { value: "Manager", label: t('members.managerRole', lang) },
                                        { value: "Audit", label: t('members.auditRole', lang) },
                                        { value: "Investor", label: t('members.investorRole', lang) },
                                        { value: "Member", label: t('members.memberRole', lang) }
                                    ]}
                                    error={errors.userRole?.message}
                                    icon={<UserCheck size={14} className="text-brand" />}
                                />
                                <FormInput
                                    label={systemUsers.some(u => u.memberId === watchedMemberId) ? 'Reset Password' : 'Login Password'}
                                    type="password"
                                    {...register('password')}
                                    error={errors.password?.message}
                                    required={!systemUsers.some(u => u.memberId === watchedMemberId)}
                                    placeholder={systemUsers.some(u => u.memberId === watchedMemberId) ? "Leave empty to keep" : "Min 6 chars"}
                                    icon={<Key size={14} />}
                                />
                            </div>

                            <div className="bg-white/50 dark:bg-white/5 p-4 rounded-2xl flex items-start gap-3">
                                <Info size={16} className="text-brand shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-[10px] font-black text-dark dark:text-white uppercase tracking-widest mb-1">
                                        {watchedUserRole} Permissions:
                                    </p>
                                    <p className="text-[10px] font-bold text-gray-500 dark:text-gray-400 leading-relaxed">
                                        {watchedUserRole === 'Admin' && t('members.adminDesc', lang)}
                                        {watchedUserRole === 'Manager' && t('members.managerDesc', lang)}
                                        {watchedUserRole === 'Audit' && t('members.auditDesc', lang)}
                                        {watchedUserRole === 'Investor' && t('members.investorDesc', lang)}
                                        {watchedUserRole === 'Member' && t('members.memberDesc', lang)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between p-6 bg-gray-50 dark:bg-white/5 rounded-3xl">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Initial Valuation</p>
                    <p className="text-2xl font-black text-dark dark:text-brand tracking-tighter">{currencyCode} {((watchedShares || 0) * SHARE_VALUE).toLocaleString()}</p>
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
        </div >
    );

};

export default Members;
