import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000,
});

api.interceptors.request.use(
    (config) => {
        const userInfo = localStorage.getItem('userInfo');
        if (userInfo) {
            try {
                const { token } = JSON.parse(userInfo);
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            } catch (error) {
                console.error('Failed to parse user info:', error);
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Only logout on confirmed 401 Unauthorized
        if (error.response?.status === 401) {
            console.warn('Unauthorized access - logging out');
            localStorage.removeItem('userInfo');
            const currentPath = window.location.pathname;
            if (currentPath !== '/login') {
                window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
            } else {
                window.location.href = '/login';
            }
        }

        const message = error.response?.data?.message || error.message || 'An error occurred';

        // Enhance error object with network status info if applicable
        if (!error.response) {
            error.isNetworkError = true;
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

export const authService = {
    login: async (email: string, password: string) => {
        const { data } = await api.post('/auth/login', { email, password });
        if (data.token) {
            localStorage.setItem('userInfo', JSON.stringify(data));
        }
        return data;
    },
    register: async (userData: any) => {
        const { data } = await api.post('/auth/register', userData);
        return data;
    },
    getProfile: async () => {
        const { data } = await api.get('/auth/profile');
        return data;
    },
    getAllUsers: async () => {
        const { data } = await api.get('/auth/users');
        return data;
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
    getAll: async (params?: { page?: number; limit?: number; search?: string }) => {
        const { data } = await api.get('/members', { params });
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
    }
};

export const projectService = {
    getAll: async (params?: { page?: number; limit?: number; search?: string }) => {
        const { data } = await api.get('/projects', { params });
        return data;
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
    delete: async (id: string) => {
        const { data } = await api.delete(`/projects/${id}`);
        return data;
    }
};

export const fundService = {
    getAll: async () => {
        const { data } = await api.get('/funds');
        return data;
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
    getTransactions: async (params?: { page?: number; limit?: number; search?: string }) => {
        const { data } = await api.get('/finance/transactions', { params });
        return data;
    },
    addDeposit: async (depositData: any) => {
        const { data } = await api.post('/finance/deposits', depositData);
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
    }
};

export const reportService = {
    getAll: async () => {
        const { data } = await api.get('/reports');
        return data;
    },
    create: async (reportData: any) => {
        const { data } = await api.post('/reports', reportData);
        return data;
    },
    delete: async (id: string) => {
        const { data } = await api.delete(`/reports/${id}`);
        return data;
    },
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
        const { data } = await api.get('/analytics/stats');
        return data;
    },
    recalculate: async () => {
        const { data } = await api.post('/analytics/recalculate');
        return data;
    }
};

export const goalService = {
    getAll: async () => {
        const { data } = await api.get('/goals');
        return data;
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

export default api;
