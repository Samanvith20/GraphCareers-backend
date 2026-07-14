import axios from "axios";
import logger from "../logger/logger.js";
import { AppError } from "./AppError.js";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

function getApiKey() {
  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    throw new AppError("APOLLO_API_KEY is missing from environment configuration.", 500);
  }
  return key;
}

function handleApolloError(error, operation) {
  if (error.response) {
    const status = error.response.status;
    
    // Log the error carefully without exposing full sensitive payloads
    logger.error(`Apollo provider error during ${operation}`, {
      status,
      message: error.message,
      operation,
      apolloData: error.response.data
    });

    if (status === 401) {
      throw new AppError("Unauthorized: Invalid Apollo API key.", 401);
    }
    if (status === 403) {
      throw new AppError("Forbidden: Apollo plan restricts this endpoint.", 403);
    }
    if (status === 429) {
      throw new AppError("Apollo Rate Limit Exceeded.", 429);
    }
    if (status === 422) {
      throw new AppError("Apollo Validation Error: Invalid request parameters.", 422);
    }
    throw new AppError(`Apollo server error: ${status}`, 502);
  } else if (error.request) {
    logger.error(`Apollo network timeout/error during ${operation}`, { message: error.message });
    throw new AppError("Network error communicating with Apollo.", 503);
  } else {
    logger.error(`Unknown Apollo error during ${operation}`, { message: error.message });
    throw new AppError("Internal error interacting with Apollo.", 500);
  }
}

/**
 * Searches for people on Apollo.
 * @param {Object} params - { companyDomain, titles, page, perPage }
 */
export async function searchPeople({ companyDomain, companyName, titles = [], page = 1, perPage = 10 }) {
  const apiKey = getApiKey();

  try {
    const payload = {
      page,
      per_page: perPage,
    };

    if (companyDomain) {
      payload.q_organization_domains = companyDomain;
    }
    if (companyName) {
      payload.q_organization_name = companyName;
    }

    if (titles && titles.length > 0) {
      payload.person_titles = titles;
    }

    const response = await axios.post(
      `${APOLLO_BASE_URL}/mixed_people/api_search`,
      payload,
      { 
        timeout: 30000,
        headers: { "X-Api-Key": apiKey }
      }
    );

    const people = response.data.people || [];
    
    const normalizedPeople = people.map(p => ({
      provider: "apollo",
      providerPersonId: p.id,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      fullName: p.name || null,
      title: p.title || null,
      seniority: p.seniority || null,
      linkedinUrl: p.linkedin_url || null,
      organizationName: p.organization?.name || null,
      organizationDomain: p.organization?.primary_domain || companyDomain
    }));

    return {
      people: normalizedPeople,
      pagination: {
        page: response.data.pagination?.page || page,
        perPage: response.data.pagination?.per_page || perPage,
        totalEntries: response.data.pagination?.total_entries || null,
      }
    };
  } catch (err) {
    handleApolloError(err, "searchPeople");
  }
}

/**
 * Enriches a single person to find their email.
 * @param {Object} params - { providerPersonId, linkedinUrl, firstName, lastName, companyDomain }
 */
export async function enrichPerson({ providerPersonId, linkedinUrl, firstName, lastName, companyDomain }) {
  const apiKey = getApiKey();

  try {
    const payload = {};
    
    // Use the strongest available identifier
    if (providerPersonId) {
      payload.id = providerPersonId;
    } else if (linkedinUrl) {
      payload.linkedin_url = linkedinUrl;
    } else {
      payload.first_name = firstName;
      payload.last_name = lastName;
      payload.domain = companyDomain;
    }

    const response = await axios.post(
      `${APOLLO_BASE_URL}/people/match`,
      payload,
      { 
        timeout: 30000,
        headers: { "X-Api-Key": apiKey }
      }
    );

    const p = response.data.person;
    if (!p) {
      return null;
    }

    return {
      provider: "apollo",
      providerPersonId: p.id,
      firstName: p.first_name || null,
      lastName: p.last_name || null,
      fullName: p.name || null,
      title: p.title || null,
      linkedinUrl: p.linkedin_url || null,
      email: p.email || null,
      emailStatus: p.email_status || null,
      organizationName: p.organization?.name || null,
      organizationDomain: p.organization?.primary_domain || null
    };
  } catch (err) {
    handleApolloError(err, "enrichPerson");
  }
}
