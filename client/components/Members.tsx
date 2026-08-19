
import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail, Phone, MapPin, MoreVertical, Plus, Edit2, Trash2, X, Search, Filter, Hash, UserCheck, Lock, User as UserIcon, Users, CreditCard, ShieldCheck, Key, Info, RefreshCw, CheckCircle2 } from 'lucide-react';
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
import { InlineTopForm } from './ui/InlineTopForm';
import { FormPhoneInput } from './ui/FormPhoneInput';
import PermissionGuard from './PermissionGuard';
import { memberSchema, MemberFormData } from '../utils/validations';
import SummaryMetricCard from './SummaryMetricCard';
import { Button } from './ui/Button';

const SHARE_VALUE = 1000;

// Member ID is now handled by server-side sequential logic or explicit user input.
// Initial pre-fill can be empty or a simple placeholder.

interface MembersProps {
    lang: Language;
}

const Members: React.FC<MembersProps> = ({ lang }) => {
    const { members = [], addMember, updateMember, deleteMember, addSystemUser, onboardMember, systemUsers = [], refreshMembers, currentUser, updateUserPassword, currencyCode } = useGlobalState();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingMember, setEditingMember] = useState<Member | null>(null);
    const [createUserAccess, setCreateUserAccess] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [sortBy, setSortBy] = useState('name');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
    const safeMembers = Array.isArray(members) ? members : [];
    const [paginatedMembers, setPaginatedMembers] = useState<{
        data: Member[];
        total: number;
        pages: number;
        meta?: any;
    }>(() => ({
        data: safeMembers.slice(0, 10),
        total: safeMembers.length,
        pages: Math.ceil(safeMembers.length / 10) || 1,
    }));
    const [loading, setLoading] = useState(() => safeMembers.length === 0);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const fetchPaginatedMembers = async (page: number, search: string, limit: number, sort: string, order: 'asc' | 'desc') => {
        if (paginatedMembers.data.length === 0) {
            setLoading(true);
        }
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
        clearErrors,
        control
    } = useForm<MemberFormData>({
        resolver: zodResolver(memberSchema) as any,
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
                nidOrPassport: member.nidOrPassport || '',
                fatherName: member.fatherName || '',
                address: member.address || '',
                nomineeName: member.nomineeName || '',
                nomineeRelation: member.nomineeRelation || '',
                nomineeNidOrPassport: member.nomineeNidOrPassport || '',
                nomineePhone: member.nomineePhone || '',
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
                nidOrPassport: '',
                fatherName: '',
                address: '',
                nomineeName: '',
                nomineeRelation: '',
                nomineeNidOrPassport: '',
                nomineePhone: '',
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
            nidOrPassport: '',
            fatherName: '',
            address: '',
            nomineeName: '',
            nomineeRelation: '',
            nomineeNidOrPassport: '',
            nomineePhone: '',
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
                    status: 'active',
                    nidOrPassport: data.nidOrPassport,
                    fatherName: data.fatherName,
                    address: data.address,
                    nomineeName: data.nomineeName,
                    nomineeRelation: data.nomineeRelation,
                    nomineeNidOrPassport: data.nomineeNidOrPassport,
                    nomineePhone: data.nomineePhone
                });
                showNotification(
                    data.createUserAccess
                        ? t('members.onboardedAccess', lang).replace('{name}', data.name)
                        : t('members.onboarded', lang).replace('{name}', data.name)
                );
            } else {
                // Standard Update (Profile & System Access)
                const updatedMember: any = {
                    id: editingMember.id,
                    name: data.name,
                    phone: data.phone,
                    email: data.email,
                    role: data.role,
                    hasUserAccess: data.createUserAccess,
                    password: data.password ? data.password : undefined,
                    userRole: data.userRole || 'Investor',
                    nidOrPassport: data.nidOrPassport,
                    fatherName: data.fatherName,
                    address: data.address,
                    nomineeName: data.nomineeName,
                    nomineeRelation: data.nomineeRelation,
                    nomineeNidOrPassport: data.nomineeNidOrPassport,
                    nomineePhone: data.nomineePhone
                };
                await updateMember(updatedMember);
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
        // Show comprehensive review dialog with all new implementation details
        const reviewDetails: { label: string; value: string | number }[] = [
            { label: t('members.legalName', lang), value: data.name },
            { label: t('members.memberId', lang), value: data.memberId || 'Auto-generated' },
            { label: 'Member Type / Category', value: data.role || 'Normal Shareholder' },
            { label: 'Email Identifier', value: data.email },
            { label: 'Contact Phone', value: data.phone || 'N/A' },
        ];

        if (data.nidOrPassport) {
            reviewDetails.push({ label: 'NID / Passport Number', value: data.nidOrPassport });
        }
        if (data.fatherName) {
            reviewDetails.push({ label: 'Father / Guardian', value: data.fatherName });
        }
        if (data.address) {
            reviewDetails.push({ label: 'Residential Address', value: data.address });
        }
        if (data.nomineeName) {
            reviewDetails.push({ label: 'Nominee Beneficiary', value: `${data.nomineeName}${data.nomineeRelation ? ` (${data.nomineeRelation})` : ''}` });
        }
        if (data.nomineeNidOrPassport) {
            reviewDetails.push({ label: 'Nominee NID / Passport', value: data.nomineeNidOrPassport });
        }
        if (data.nomineePhone) {
            reviewDetails.push({ label: 'Nominee Contact Phone', value: data.nomineePhone });
        }

        reviewDetails.push(
            { label: t('members.shares', lang), value: `${data.shares} Shares` },
            { label: t('members.valuation', lang), value: `${currencyCode} ${((data.shares || 0) * SHARE_VALUE).toLocaleString()}` },
            { label: t('members.systemAccess', lang), value: data.createUserAccess ? `Active Portal (${data.userRole || 'Investor'})` : 'No Portal Access' }
        );

        setDialog({
            isOpen: true,
            type: 'review',
            title: editingMember ? 'Review Profile Updates' : t('members.reviewTitle', lang),
            message: t('members.reviewMessage', lang),
            details: reviewDetails,
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
    const userRole = (currentUser?.role || '').toLowerCase();
    const canViewSensitiveData = userRole === 'admin' || userRole === 'manager';

    const tableColumns: TableColumn<Member>[] = [
        {
            key: 'name',
            header: t('members.partnerIdentity', lang),
            sortable: true,
            render: (member) => {
                const getRoleBadgeStyle = (roleStr: string) => {
                    const r = (roleStr || '').toLowerCase();
                    if (r.includes('founding')) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';
                    if (r.includes('investor')) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';
                    if (r.includes('board') || r.includes('director')) return 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
                    if (r.includes('associate')) return 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20';
                    return 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20';
                };

                return (
                    <div className="flex items-center gap-3">
                        <Avatar name={member.name} size="sm" />
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <p className="font-bold text-slate-900 dark:text-white text-xs leading-none">{member.name}</p>
                                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${getRoleBadgeStyle(member.role)}`}>
                                    {member.role || 'Normal Shareholder'}
                                </span>
                            </div>
                            {canViewSensitiveData && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    {member.nidOrPassport && (
                                        <span className="text-[9px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700">
                                            NID: {member.nidOrPassport}
                                        </span>
                                    )}
                                    {member.fatherName && (
                                        <span className="text-[9px] text-gray-400 dark:text-gray-500">
                                            F/N: {member.fatherName}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            }
        },
        {
            key: 'memberId',
            header: t('members.memberId', lang),
            sortable: true,
            cellClassName: 'font-mono text-xs font-bold text-slate-700 dark:text-blue-400',
            render: (member) => (
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse" title="Active Stakeholder" />
                    <span>#{member.memberId}</span>
                </div>
            )
        },
        ...(canViewSensitiveData ? [
            {
                key: 'phone' as const,
                header: 'Contact & Address',
                cellClassName: 'text-xs text-slate-650 dark:text-gray-300',
                render: (member: Member) => (
                    <div className="flex flex-col space-y-0.5">
                        <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">{member.phone || 'No phone'}</span>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500">{member.email}</span>
                        {member.address && (
                            <span className="text-[9px] text-slate-450 dark:text-slate-400 flex items-center gap-1 max-w-[180px]" title={member.address}>
                                <MapPin size={10} className="text-slate-400 shrink-0" />
                                <span className="truncate">{member.address}</span>
                            </span>
                        )}
                    </div>
                )
            },
            {
                key: 'nomineeName' as const,
                header: 'Nominee Beneficiary',
                render: (member: Member) => (
                    member.nomineeName ? (
                        <div className="flex flex-col space-y-0.5">
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">{member.nomineeName}</span>
                                {member.nomineeRelation && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/50">
                                        {member.nomineeRelation}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
                                {member.nomineePhone && (
                                    <span className="flex items-center gap-1">
                                        <Phone size={10} className="text-slate-400 shrink-0" />
                                        {member.nomineePhone}
                                    </span>
                                )}
                                {member.nomineeNidOrPassport && (
                                    <span className="flex items-center gap-1">
                                        <CreditCard size={10} className="text-slate-400 shrink-0" />
                                        {member.nomineeNidOrPassport}
                                    </span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <span className="text-[10px] italic text-gray-400 dark:text-gray-600">Unspecified</span>
                    )
                )
            }
        ] : []),
        {
            key: 'shares',
            header: `${t('members.shares', lang)} & Equity`,
            sortable: true,
            align: 'center',
            render: (member) => (
                <div className="flex flex-col items-center">
                    <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-200">{member.shares} Units</span>
                    <span className="text-[9px] font-mono text-slate-450 dark:text-slate-400">
                        {currencyCode} {((member.shares || 0) * SHARE_VALUE).toLocaleString()}
                    </span>
                </div>
            )
        },
        {
            key: 'successfulDepositTotal',
            header: t('members.totalContribution', lang),
            sortable: true,
            align: 'right',
            render: (member) => {
                const totalContrib = member.successfulDepositTotal || 0;
                const poolPercent = totalPool > 0 ? ((totalContrib / totalPool) * 100).toFixed(1) : '0';
                return (
                    <div className="flex flex-col items-end">
                        <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">
                            {currencyCode} {totalContrib.toLocaleString()}
                        </span>
                        <span className="text-[9px] font-black text-emerald-600 dark:text-emerald-400">
                            {poolPercent}% of Total Pool
                        </span>
                    </div>
                );
            }
        },
        {
            key: 'hasUserAccess',
            header: t('members.systemAccess', lang),
            align: 'center',
            render: (member) => {
                const hasAccess = member.hasUserAccess || systemUsers.some(u => u.memberId === member.memberId);
                return (
                    <div className="flex justify-center">
                        {hasAccess ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg text-[10px] font-bold border border-emerald-500/20" title={t('common.authorizedBadge', lang)}>
                                <CheckCircle2 size={12} strokeWidth={2.5} /> Active
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-500/5 text-gray-400 rounded-lg text-[10px] font-semibold border border-gray-500/10 opacity-60" title={t('common.restrictedBadge', lang)}>
                                <Lock size={10} strokeWidth={2} /> No Access
                            </span>
                        )}
                    </div>
                );
            }
        },
        {
            key: 'actions',
            header: t('members.action', lang),
            align: 'right',
            render: (member) => (
                <PermissionGuard screen={AppScreen.MEMBERS} requiredLevel={AccessLevel.WRITE}>
                    <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => handleOpenModal(member)} className="p-1.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-slate-800 text-gray-500 hover:text-blue-600 transition-colors shadow-sm" title="Edit Member Profile">
                            <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDeleteClick(member)} className="p-1.5 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 text-red-500 hover:text-red-600 transition-colors shadow-sm" title="Archive Stakeholder">
                            <Trash2 size={14} />
                        </button>
                    </div>
                </PermissionGuard>
            )
        }
    ];

    return (
        <div className="space-y-4">
            <Toast isVisible={toast.isVisible} message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, isVisible: false })} />

            <div className="flex items-center justify-between">
                <div>
                    <nav className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 uppercase tracking-wider mb-1">
                        <span>{t('nav.management', lang)}</span>
                        <span className="opacity-30">/</span>
                        <span className="text-blue-600 dark:text-blue-400">{t('members.stakeholders', lang)}</span>
                    </nav>
                    <div className="flex items-center gap-2">
                        <h1 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">{t('nav.members', lang)}</h1>
                        <button
                            onClick={handleRefresh}
                            className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 transition-all ${refreshing ? 'animate-spin' : ''}`}
                        >
                            <RefreshCw size={14} />
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
                                className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 transition-all ${refreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                                title="Recalculate Financials"
                                disabled={refreshing}
                            >
                                <Hash size={14} />
                            </button>
                        </PermissionGuard>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <ExportMenu
                        data={members}
                        columns={[
                            { header: t('members.name', lang) || 'Partner Name', key: 'name', format: (m: any) => m.name || 'N/A' },
                            { header: t('members.memberId', lang) || 'Partner ID', key: 'memberId', format: (m: any) => m.memberId || 'N/A' },
                            ...(canViewSensitiveData ? [
                                { header: t('members.phone', lang) || 'Phone', key: 'phone', format: (m: any) => m.phone || 'N/A' },
                                { header: 'Address', key: 'address', format: (m: any) => m.address || 'N/A' },
                                { header: 'Nominee Name', key: 'nomineeName', format: (m: any) => m.nomineeName || 'N/A' },
                                { header: 'Nominee Relation', key: 'nomineeRelation', format: (m: any) => m.nomineeRelation || 'N/A' },
                            ] : []),
                            { header: t('members.role', lang) || 'Role', key: 'role', format: (m: any) => m.role || 'Member' },
                            { header: t('members.shares', lang) || 'Shares', key: 'shares', format: (m: any) => m.shares ?? 0 },
                            { header: `${t('members.totalContribution', lang) || 'Total Contribution'} (${currencyCode})`, key: 'successfulDepositTotal', format: (m: any) => Number(m.successfulDepositTotal || 0).toLocaleString() },
                            { header: t('members.access', lang) || 'System Access', key: 'hasUserAccess', format: (m: any) => m.hasUserAccess ? (lang === 'bn' ? 'হ্যাঁ' : 'Active') : (lang === 'bn' ? 'না' : 'Inactive') }
                        ]}
                        fileName={`members_${new Date().toISOString().split('T')[0]}`}
                        title="Stakeholder Register"
                        lang={lang}
                        targetId="members-snapshot-target"
                    />
                    <PermissionGuard screen={AppScreen.MEMBERS} requiredLevel={AccessLevel.WRITE}>
                        <button
                            onClick={() => handleOpenModal()}
                            className="bg-dark dark:bg-brand text-white dark:text-dark px-10 py-5 rounded-[2rem] font-black text-sm uppercase flex items-center gap-3 hover:scale-105 transition-all shadow-2xl shadow-brand/20"
                        >
                            <Plus size={20} strokeWidth={3} /> {t('common.add', lang)}
                        </button>
                    </PermissionGuard>
                </div>
            </div>
            <div id="members-snapshot-target" className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

                <div className="bg-white dark:bg-slate-900 rounded border border-gray-200 dark:border-gray-800 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-4">
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
                        loadingMessage="Loading members..."
                        emptyMessage={<p className="text-xs font-semibold text-gray-400">No stakeholders found matching your search</p>}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                        rowKey={(member, index) => member.id || member.memberId || `member-${index}`}
                    />

                    <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-xs font-medium text-slate-500">
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

            <InlineTopForm
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                title={t('members.intake', lang)}
                subtitle={`${t('members.memberId', lang)}: #${watchedMemberId || 'Auto'}`}
                onSubmit={handleSubmit((data) => handleReviewSubmit(data as any))}
                submitLabel={t('common.save', lang)}
                loading={isSubmitting || isFormSubmitting}
            >
                <div className="space-y-6">
                    {/* SECTION 1: PRIMARY IDENTITY */}
                    <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                            <UserIcon size={14} className="text-brand" /> Primary Profile & Contact
                        </h4>
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
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
                            <Controller
                                control={control}
                                name="phone"
                                render={({ field }) => (
                                    <FormPhoneInput
                                        label={t('members.phone', lang)}
                                        value={field.value}
                                        onChange={field.onChange}
                                        error={errors.phone?.message}
                                    />
                                )}
                            />
                            <FormSelect
                                label="Member Type / Category"
                                {...register('role')}
                                options={[
                                    { value: "Founding Member", label: "Founding Member" },
                                    { value: "Normal Shareholder", label: "Normal Shareholder" },
                                    { value: "Investor", label: "Investor" },
                                    { value: "Associate Member", label: "Associate Member" },
                                    { value: "Board Director", label: "Board Director" }
                                ]}
                                error={errors.role?.message}
                                required
                            />
                        </div>
                    </div>

                    {/* SECTION 2: KYC & IDENTIFICATION */}
                    <div>
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                            <CreditCard size={14} className="text-emerald-500" /> KYC & Identification Details
                        </h4>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <FormInput
                                label="NID / Passport Number"
                                placeholder="e.g. 1990123456789"
                                {...register('nidOrPassport')}
                                error={errors.nidOrPassport?.message}
                            />
                            <FormInput
                                label="Father / Guardian Name"
                                placeholder="Full Name"
                                {...register('fatherName')}
                                error={errors.fatherName?.message}
                            />
                            <FormInput
                                label="Residential Address"
                                placeholder="House, Road, City, District"
                                {...register('address')}
                                error={errors.address?.message}
                            />
                        </div>
                    </div>

                    {/* SECTION 3: NOMINEE INFORMATION */}
                    <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-gray-200/80 dark:border-gray-800">
                        <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3 flex items-center gap-2">
                            <Users size={14} className="text-blue-500" /> Nominee & Beneficiary Information
                        </h4>
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                            <FormInput
                                label="Nominee Full Name"
                                placeholder="Nominee Legal Name"
                                {...register('nomineeName')}
                                error={errors.nomineeName?.message}
                            />
                            <FormSelect
                                label="Relationship"
                                {...register('nomineeRelation')}
                                options={[
                                    { value: "", label: "Select Relationship" },
                                    { value: "Spouse", label: "Spouse" },
                                    { value: "Son", label: "Son" },
                                    { value: "Daughter", label: "Daughter" },
                                    { value: "Father", label: "Father" },
                                    { value: "Mother", label: "Mother" },
                                    { value: "Brother", label: "Brother" },
                                    { value: "Sister", label: "Sister" },
                                    { value: "Other", label: "Other" }
                                ]}
                                error={errors.nomineeRelation?.message}
                            />
                            <FormInput
                                label="Nominee NID / Passport"
                                placeholder="Nominee NID / DOB"
                                {...register('nomineeNidOrPassport')}
                                error={errors.nomineeNidOrPassport?.message}
                            />
                            <Controller
                                control={control}
                                name="nomineePhone"
                                render={({ field }) => (
                                    <FormPhoneInput
                                        label="Nominee Contact Phone"
                                        value={field.value}
                                        onChange={field.onChange}
                                        error={errors.nomineePhone?.message}
                                    />
                                )}
                            />
                        </div>
                    </div>

                    {/* SECTION 4: SHARES */}
                    <FormInput
                        label={t('members.shares', lang)}
                        type="number"
                        {...register('shares', { valueAsNumber: true })}
                        error={errors.shares?.message}
                        required
                        disabled={!!editingMember}
                        title={editingMember ? 'Shares are locked after creation. Use deposits to increase shares.' : ''}
                    />
                </div>
                {editingMember && (
                    <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1">
                        <Lock size={10} /> Shares are locked — changes are derived from total deposits
                    </p>
                )}

                {/* System Access Section */}
                <div className={`p-4 rounded-2xl transition-colors ${watchedCreateUserAccess ? 'bg-blue-50/50 dark:bg-blue-950/10 border border-blue-200 dark:border-blue-900/50' : 'bg-slate-50 dark:bg-slate-800/50 border border-gray-200 dark:border-gray-800'}`}>
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <div className={`p-2 rounded-xl transition-colors ${watchedCreateUserAccess ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-400'}`}>
                                <ShieldCheck size={18} />
                            </div>
                            <div>
                                <h4 className={`text-xs font-semibold ${watchedCreateUserAccess ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>{t('members.systemAccessControl', lang)}</h4>
                                <p className="text-[10px] font-medium text-slate-450 mt-0.5">
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
                            <div className="w-11 h-6 bg-gray-200 dark:bg-slate-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 shadow-inner"></div>
                        </label>
                    </div>

                    {watchedCreateUserAccess && (
                        <div className="space-y-4 pt-4 border-t border-gray-200 dark:border-gray-800">
                            <div className="grid grid-cols-2 gap-4">
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
                                    icon={<UserCheck size={14} className="text-blue-600 dark:text-blue-400" />}
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

                            <div className="bg-gray-50 dark:bg-slate-850 p-3 rounded-xl border border-gray-200 dark:border-gray-800 flex items-start gap-3">
                                <Info size={14} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white mb-1">
                                        {watchedUserRole} Permissions:
                                    </p>
                                    <p className="text-xs text-slate-500 leading-relaxed">
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

                <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-gray-200 dark:border-gray-800">
                    <p className="text-xs font-semibold text-slate-500">Initial Valuation</p>
                    <p className="text-xl font-semibold text-slate-900 dark:text-blue-400 font-mono">{currencyCode} {((watchedShares || 0) * SHARE_VALUE).toLocaleString()}</p>
                </div>
            </InlineTopForm>

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
