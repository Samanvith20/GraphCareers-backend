import { AppError } from "./AppError.js";
import fs from "fs";

const PROSPEO_BASE_URL = "https://api.prospeo.io";

function getApiKey() {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) {
    throw new AppError("Prospeo API key is not configured.", 500);
  }
  return key;
}

export const ProspeoProvider = {
  searchPeople: async (companyDomain, page = 1) => {
    const apiKey = getApiKey();
    const url = `${PROSPEO_BASE_URL}/search-person`;

    const payload = {
      page,
      filters: {
        company: {
          websites: {
            include: [companyDomain]
          }
        }
      }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KEY": apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        if (response.status === 404) return { candidates: [], total: 0 };
        throw new AppError(`Prospeo API Error (Search): ${response.status} ${response.statusText}`, response.status);
      }

      const data = await response.json();
      fs.writeFileSync("prospeo_response.json", JSON.stringify(data, null, 2));
      const rawResponse = data.results || [];
      
      const candidates = rawResponse.map(item => {
        const person = item.person || {};
        const company = item.company || {};
        return {
          provider: "prospeo",
          providerPersonId: person.person_id,
          fullName: person.full_name || null,
          currentJobTitle: person.current_job_title || null,
          seniority: person.job_history?.[0]?.seniority || null,
          departments: person.job_history?.[0]?.departments || [],
          linkedinUrl: person.linkedin_url || null,
          emailStatus: person.email?.status || null,
          emailRevealed: person.email?.revealed || false,
          maskedEmail: person.email?.email || null,
          companyDomain: company.domain || company.website || null,
          companyEmployeeCount: company.employee_count || null,
          companyEmployeeRange: company.employee_range || null
        };
      });

      return {
        candidates,
        total: data.pagination?.total_count || candidates.length
      };

    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Prospeo Network Error: ${error.message}`, 500);
    }
  },

  enrichPerson: async (providerPersonId) => {
    const apiKey = getApiKey();
    const url = `${PROSPEO_BASE_URL}/enrich-person`;

    const payload = {
      only_verified_email: true,
      enrich_mobile: false,
      data: {
        person_id: providerPersonId
      }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-KEY": apiKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new AppError(`Prospeo API Error (Enrich): ${response.status} ${response.statusText}`, response.status);
      }

      const data = await response.json();
      fs.writeFileSync("prospeo_enrich_response.json", JSON.stringify(data, null, 2));
      
      const person = data.person || {};
      const emailObj = person.email || {};

      return {
        provider: "prospeo",
        providerPersonId: person.id,
        fullName: person.full_name || null,
        title: person.job_title || null,
        linkedinUrl: person.linkedin || null,
        email: emailObj.email || null,
        emailStatus: emailObj.status || null,
        emailRevealed: emailObj.revealed || false
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`Prospeo Network Error: ${error.message}`, 500);
    }
  }
};
