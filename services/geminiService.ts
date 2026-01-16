
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const getAdvancedFinancialAdvice = async (state: any): Promise<string> => {
  try {
    const contextStr = JSON.stringify({
      totalFunds: state.funds.reduce((acc: number, f: any) => acc + f.balance, 0),
      activeProjects: state.projects.filter((p: any) => p.status === 'In Progress').length,
      memberCount: state.members.length,
      recentExpenses: state.expenses.slice(0, 5),
    });

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are the InvestWise AI Strategist. Analyze this financial state: ${contextStr}. 
      Provide 3 extremely concise, actionable bullet points for the board of directors. 
      Focus on capital efficiency, risk, and member growth.
      Language: English (Professional but easy).`,
    });

    return response.text || "Continue monitoring capital flow and project milestones.";
  } catch (error) {
    console.error("AI Error:", error);
    return "Ensure high liquidity in primary funds before launching new ventures.";
  }
};
