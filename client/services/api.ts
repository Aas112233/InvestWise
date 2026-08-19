import axios, { InternalAxiosRequestConfig } from 'axios';

// Augment axios to support metadata on requests
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: { retryCount?: number; startTime?: number };
  }
}

const DEFAULT_API_BASE_URL = 'http://localhost:5000/api';

const normalizeApiBaseUrl = (value?: string) => {
    const normalizedValue = (value || DEFAULT_API_BASE_URL).replace(/\s+/g, '').replace(/\/+$/, '');
    return normalizedValue || DEFAULT_API_BASE_URL;
};

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_URL);

const api = axios.create({
    baseURL: apiBaseUrl,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second
const MAX_RETRY_DELAY = 10000; // 10 seconds

// Token refresh lock to prevent multiple simultaneous refresh requests
let isRefreshing = false;
let refreshSubscribers: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
}> = [];
let isRedirectingToLogin = false;

// Subscribe to token refresh
const subscribeTokenRefresh = (resolve: (token: string) => void, reject: (error: any) => void) => {
    refreshSubscribers.push({ resolve, reject });
};

// Call all refresh subscribers on success
const onRefreshed = (token: string) => {
    refreshSubscribers.forEach(sub => sub.resolve(token));
    refreshSubscribers = [];
};

// Reject all refresh subscribers on failure
const onRefreshFailed = (error: any) => {
    refreshSubscribers.forEach(sub => sub.reject(error));
    refreshSubscribers = [];
};

// Helper function to delay execution
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const redirectToLogin = (params?: { session?: string; error?: string }) => {
    if (typeof window === 'undefined' || isRedirectingToLogin) {
        return;
    }

    if (window.location.pathname === '/login') {
        return;
    }

    isRedirectingToLogin = true;
    localStorage.removeItem('userInfo');

    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const loginUrl = new URL('/login', window.location.origin);

    loginUrl.searchParams.set('session', params?.session || 'expired');

    if (currentPath !== '/login') {
        loginUrl.searchParams.set('redirect', currentPath);
    }

    if (params?.error) {
        loginUrl.searchParams.set('error', params.error);
    }

    window.location.replace(loginUrl.toString());
};

const isPublicAuthEndpoint = (url?: string) => {
    if (!url) return false;
    return url.includes('/auth/login') || url.includes('/auth/register');
};

const isRefreshEndpoint = (url?: string) => {
    if (!url) return false;
    return url.includes('/auth/refresh');
};

// Helper function to check if error is retryable
const isRetryableError = (error: any): boolean => {
    // Don't retry on 4xx errors (client errors)
    if (error.response?.status >= 400 && error.response?.status < 500) {
        return false;
    }

    // Retry on network errors, timeouts, or 5xx errors
    return !error.response ||
        error.code === 'ERR_NETWORK' ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        (error.response?.status >= 500) ||
        error.message?.includes('Network Error');
};

// Enhanced request interceptor with retry logic
api.interceptors.request.use(
    (config) => {
        const userInfo = localStorage.getItem('userInfo');
        if (userInfo) {
            try {
                const { accessToken, token } = JSON.parse(userInfo);
                // Use accessToken if available (new format), otherwise fallback to token (legacy)
                const authToken = accessToken || token;
                if (authToken) {
                    config.headers.Authorization = `Bearer ${authToken}`;
                }
            } catch (error) {
                console.error('Failed to parse user info:', error);
            }
        }

        config.metadata = config.metadata || {};
        config.metadata.retryCount = config.metadata.retryCount || 0;

        return config;
    },
    (error) => Promise.reject(error)
);

// Enhanced response interceptor with retry logic
api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const config = error.config;
        const originalRequest = config;
        const requestUrl = originalRequest?.url as string | undefined;

        // Check if we should retry
        if (config && isRetryableError(error) && (config.metadata?.retryCount || 0) < MAX_RETRIES) {
            config.metadata.retryCount = (config.metadata.retryCount || 0) + 1;

            // Calculate delay with exponential backoff
            const retryDelay = Math.min(RETRY_DELAY * Math.pow(2, config.metadata.retryCount - 1), MAX_RETRY_DELAY);

            // Silent retry — no toast, no console noise

            await delay(retryDelay);
            return api(config);
        }

        // Handle 401 - Token expired, try to refresh
        if (error.response?.status === 401 && !config.sent) {
            if (isPublicAuthEndpoint(requestUrl) || isRefreshEndpoint(requestUrl)) {
                return Promise.reject(error);
            }

            config.sent = true;

            const userInfo = localStorage.getItem('userInfo');
            if (userInfo) {
                if (!isRefreshing) {
                    isRefreshing = true;

                    try {
                        // Try to refresh token via HttpOnly cookie (or body fallback)
                        let refreshToken: string | undefined;
                        try {
                            const parsed = JSON.parse(userInfo);
                            refreshToken = parsed.refreshToken;
                        } catch {}

                        const { data } = await api.post('/auth/refresh', refreshToken ? { refreshToken } : {});

                        // Update stored user info with refreshed tokens
                        if (userInfo && data.accessToken) {
                            try {
                                const parsed = JSON.parse(userInfo);
                                parsed.accessToken = data.accessToken;
                                if (data.refreshToken) {
                                    parsed.refreshToken = data.refreshToken;
                                }
                                localStorage.setItem('userInfo', JSON.stringify(parsed));
                            } catch {}
                        }

                        isRefreshing = false;
                        onRefreshed(data.accessToken || '');

                        // Retry original request
                        if (data.accessToken) {
                            originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
                        }
                        return api(originalRequest);
                    } catch (refreshError) {
                        isRefreshing = false;
                        onRefreshFailed(refreshError);
                        // Refresh failed, logout user immediately
                        console.warn('Token refresh failed, redirecting to login');
                        redirectToLogin({ session: 'expired' });

                        return Promise.reject(refreshError);
                    }
                } else {
                    // Wait for the refresh to complete
                    return new Promise((resolve, reject) => {
                        subscribeTokenRefresh((token: string) => {
                            if (token) {
                                originalRequest.headers.Authorization = `Bearer ${token}`;
                            }
                            resolve(api(originalRequest));
                        }, reject);
                    });
                }
            }
        }

        return Promise.reject(error);
    }
);

export const isNetworkError = (error: any): boolean => {
    return !error.response ||
        error.code === 'ERR_NETWORK' ||
        error.code === 'ECONNABORTED' ||
        error.message.includes('Network Error');
};

export const isDatabaseError = (error: any): boolean => {
    return error.isDatabaseError === true ||
        error.response?.data?.error === 'SERVICE_UNAVAILABLE' ||
        error.response?.data?.error === 'DATABASE_UNREACHABLE' ||
        error.response?.status === 503;
};

// In-flight GET request deduplication cache
const inFlightGetRequests = new Map<string, Promise<any>>();

const deduplicatedGet = async <T = any>(url: string, config?: any): Promise<T> => {
    const key = `${url}:${JSON.stringify(config || {})}`;
    if (inFlightGetRequests.has(key)) {
        return inFlightGetRequests.get(key)!;
    }

    const requestPromise = api.get<T>(url, config)
        .then((response) => response.data)
        .finally(() => {
            inFlightGetRequests.delete(key);
        });

    inFlightGetRequests.set(key, requestPromise);
    return requestPromise;
};

export const authService = {
    login: async (email: string, password: string) => {
        const { data } = await api.post('/auth/login', { email, password });
        if (data) {
            localStorage.setItem('userInfo', JSON.stringify(data));
        }
        return data;
    },
    logout: async () => {
        try {
            await api.post('/auth/logout');
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            localStorage.removeItem('userInfo');
        }
    },
    logoutAllDevices: async () => {
        try {
            await api.post('/auth/logout-all');
        } catch (error) {
            console.error('Logout all error:', error);
        } finally {
            localStorage.removeItem('userInfo');
        }
    },
    refreshToken: async (refreshToken?: string) => {
        const { data } = await api.post('/auth/refresh', refreshToken ? { refreshToken } : {});
        return data;
    },
    register: async (userData: any) => {
        const { data } = await api.post('/auth/register', userData);
        return data;
    },
    getProfile: async () => {
        return deduplicatedGet('/auth/profile');
    },
    getAllUsers: async () => {
        return deduplicatedGet('/auth/users');
    },
    updateUser: async (id: string, data: any) => {
        const { data: responseData } = await api.put(`/auth/users/${id}`, data);
        return responseData;
    },
    deleteUser: async (id: string) => {
        const { data } = await api.delete(`/auth/users/${id}`);
        return data;
    },
    updateUserPassword: async (id: string, password: any) => {
        const { data } = await api.put(`/auth/users/${id}/password`, { password });
        return data;
    },
};

export const memberService = {
    getAll: async (params?: { page?: number; limit?: number; search?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' }) => {
        return deduplicatedGet('/members', { params });
    },
    getMyProfile: async () => {
        const { data } = await api.get('/members/me');
        return data;
    },
    getById: async (id: string) => {
        const { data } = await api.get(`/members/${id}`);
        return data;
    },
    create: async (memberData: any) => {
        const { data } = await api.post('/members', memberData);
        return data;
    },
    update: async (id: string, memberData: any) => {
        const { data } = await api.put(`/members/${id}`, memberData);
        return data;
    },
    delete: async (id: string) => {
        const { data } = await api.delete(`/members/${id}`);
        return data;
    },
    recalculateFinancials: async () => {
        const { data } = await api.post('/members/recalculate-financials');
        return data;
    },
    onboard: async (onboardData: any) => {
        const { data } = await api.post('/members/onboard', onboardData);
        return data;
    }
};

export const projectService = {
    getAll: async (params?: { page?: number; limit?: number; search?: string }) => {
        return deduplicatedGet('/projects', { params });
    },
    create: async (projectData: any) => {
        const { data } = await api.post('/projects', projectData);
        return data;
    },
    update: async (id: string, projectData: any) => {
        const { data } = await api.put(`/projects/${id}`, projectData);
        return data;
    },
    addUpdate: async (id: string, updateData: any) => {
        const { data } = await api.post(`/projects/${id}/updates`, updateData);
        return data;
    },
    editUpdate: async (id: string, updateId: string, updateData: any) => {
        const { data } = await api.put(`/projects/${id}/updates/${updateId}`, updateData);
        return data;
    },
    deleteUpdate: async (id: string, updateId: string) => {
        const { data } = await api.delete(`/projects/${id}/updates/${updateId}`);
        return data;
    },
    delete: async (id: string) => {
        const { data } = await api.delete(`/projects/${id}`);
        return data;
    }
};

export const fundService = {
    getAll: async () => {
        return deduplicatedGet('/funds');
    },
    create: async (fundData: any) => {
        const { data } = await api.post('/funds', fundData);
        return data;
    },
    update: async (id: string, fundData: any) => {
        const { data } = await api.put(`/funds/${id}`, fundData);
        return data;
    }
};

export const financeService = {
    getTransactions: async (params?: { page?: number; limit?: number; search?: string; searchField?: string; sortBy?: string; sortOrder?: 'asc' | 'desc'; type?: string; status?: string; projectId?: string; memberId?: string; fundId?: string; startDate?: string; endDate?: string; month?: string | number; year?: string | number; [key: string]: any }) => {
        return deduplicatedGet('/finance/transactions', { params });
    },
    addDeposit: async (depositData: any) => {
        const { data } = await api.post('/finance/deposits', depositData);
        return data;
    },
    bulkAddDeposit: async (bulkData: any) => {
        const { data } = await api.post('/finance/deposits/bulk', bulkData);
        return data;
    },
    editDeposit: async (id: string, depositData: any) => {
        const { data } = await api.put(`/finance/deposits/${id}`, depositData);
        return data;
    },
    approveDeposit: async (id: string) => {
        const { data } = await api.put(`/finance/deposits/${id}/approve`);
        return data;
    },
    addExpense: async (expenseData: any) => {
        const { data } = await api.post('/finance/expenses', expenseData);
        return data;
    },
    addEarning: async (earningData: any) => {
        const { data } = await api.post('/finance/earnings', earningData);
        return data;
    },
    editExpense: async (id: string, expenseData: any) => {
        const { data } = await api.put(`/finance/expenses/${id}`, expenseData);
        return data;
    },
    deleteTransaction: async (id: string) => {
        const { data } = await api.delete(`/finance/transactions/${id}`);
        return data;
    },
    distributeDividends: async (dividendData: any) => {
        const { data } = await api.post('/finance/dividends', dividendData, { timeout: 60000 });
        return data;
    },
    transferEquity: async (transferData: any) => {
        const { data } = await api.post('/finance/equity/transfer', transferData, { timeout: 60000 });
        return data;
    },
    transferFunds: async (transferData: any) => {
        const { data } = await api.post('/finance/transfer', transferData);
        return data;
    },
    reconcileFund: async (id: string) => {
        const { data } = await api.post(`/finance/funds/${id}/reconcile`);
        return data;
    }
};

export const reportService = {
    download: async (type: string, format: string, fiscalMonth: string) => {
        const response = await api.get(`/reports/generate/${encodeURIComponent(type)}/${format}`, {
            params: { fiscalMonth },
            responseType: 'blob',
            timeout: 60000
        });
        return response.data;
    },
    generate: async (type: string, queryString: string) => {
        const response = await api.get(`/reports/generate/${encodeURIComponent(type)}?${queryString}`, {
            responseType: 'blob',
            timeout: 60000
        });
        return response.data;
    },
    getData: async (type: string, queryString: string) => {
        const response = await api.get(`/reports/generate/${encodeURIComponent(type)}?${queryString}`, {
            timeout: 60000
        });
        return response.data;
    },
    exportGeneric: async (payload: { title?: string, columns: any[], data: any[], fileName: string, lang?: string }) => {
        const response = await api.post('/reports/export-generic', payload, {
            responseType: 'blob',
            timeout: 60000
        });
        return response.data;
    }
};

export const analyticsService = {
    getStats: async () => {
        return deduplicatedGet('/analytics/stats');
    },
    recalculate: async () => {
        const { data } = await api.post('/analytics/recalculate');
        return data;
    }
};

export const auditService = {
    getLogs: async (params?: any) => {
        return deduplicatedGet('/audit', { params });
    },
    getMetadata: async () => {
        return deduplicatedGet('/audit/metadata');
    },
    getNotifications: async () => {
        return deduplicatedGet('/audit/notifications');
    }
};

export const goalService = {
    getAll: async () => {
        return deduplicatedGet('/goals');
    },
    create: async (goalData: any) => {
        const { data } = await api.post('/goals', goalData);
        return data;
    },
    update: async (id: string, goalData: any) => {
        const { data } = await api.put(`/goals/${id}`, goalData);
        return data;
    },
    delete: async (id: string) => {
        const { data } = await api.delete(`/goals/${id}`);
        return data;
    }
};

export const meetingsService = {
    getMeetings: async (params?: Record<string, any>) => {
        return deduplicatedGet('/meetings', { params });
    },
    getMeetingById: async (id: string) => {
        return deduplicatedGet(`/meetings/${id}`);
    },
    createMeeting: async (meetingData: any) => {
        const { data } = await api.post('/meetings', meetingData);
        return data;
    },
    updateMeeting: async (id: string, meetingData: any) => {
        const { data } = await api.put(`/meetings/${id}`, meetingData);
        return data;
    },
    startMeeting: async (id: string) => {
        const { data } = await api.post(`/meetings/${id}/start`);
        return data;
    },
    recordAttendance: async (id: string, records: Array<{ memberId: string; attendanceStatus: string; notes?: string }>) => {
        const { data } = await api.post(`/meetings/${id}/attendance`, { records });
        return data;
    },
    completeMeeting: async (id: string, notes?: string | null) => {
        const { data } = await api.post(`/meetings/${id}/complete`, { notes: notes ?? null });
        return data;
    },
    deleteMeeting: async (id: string) => {
        const { data } = await api.delete(`/meetings/${id}`);
        return data;
    },
};

export const governanceService = {
    getLeaderboard: async () => {
        return deduplicatedGet('/governance/leaderboard');
    },
    getMemberPerformance: async (memberId: string, months?: number) => {
        return deduplicatedGet(`/governance/performance/member/${memberId}`, { params: { months } });
    },
    recalculateMemberPerformance: async (memberId: string) => {
        const { data } = await api.post(`/governance/performance/member/${memberId}/recalculate`);
        return data;
    },
    recalculateAllPerformance: async () => {
        const { data } = await api.post('/governance/performance/recalculate-all');
        return data;
    },
    getPenalties: async (params?: Record<string, any>) => {
        return deduplicatedGet('/governance/penalties', { params });
    },
    getMemberPenalties: async (memberId: string) => {
        return deduplicatedGet(`/governance/penalties/member/${memberId}`);
    },
    issuePenalty: async (penaltyData: any) => {
        const { data } = await api.post('/governance/penalties', penaltyData);
        return data;
    },
    adjustMemberPerformance: async (memberId: string, newScore: number, reason?: string) => {
        const { data } = await api.post(`/governance/performance/member/${memberId}/adjust`, { newScore, reason });
        return data;
    },
    waivePenalty: async (id: string, waiveReason: string) => {
        const { data } = await api.post(`/governance/penalties/${id}/waive`, { waiveReason });
        return data;
    },
};

export const settingsService = {
    get: async () => {
        return deduplicatedGet('/settings');
    },
    update: async (settingsData: any) => {
        const { data } = await api.put('/settings', settingsData);
        return data;
    }
};

export default api;
