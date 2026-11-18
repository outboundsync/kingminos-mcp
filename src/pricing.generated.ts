// Generated from inventory/openapi-surfaces.json `pricing` by
// `npm run inventory:refresh` / `npm run pricing:generate`. Do not edit:
// prices come only from the API (x-kingminos-pricing in the live spec).
import type { PricingMap } from "./pricing.js";

export const CAPABILITY_PRICING: PricingMap = {
  company_b2b_social: {
    id: "company.b2b_social",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 1,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 2,
        delivered: 1.2,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 3,
        delivered: 1.4,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 4,
        delivered: 1.4,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [
      {
        provider: "wiza",
        price: 15,
      },
    ],
  },
  company_description: {
    id: "company.description",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 1,
        delivered: {
          min: 0,
          max: 1,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 2,
        delivered: {
          min: 0,
          max: 2,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 3,
        delivered: {
          min: 0,
          max: 3,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 6,
        delivered: {
          min: 0,
          max: 6,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  company_domain: {
    id: "company.domain",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 0,
        delivered: 0,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 0,
        delivered: 0,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 3,
        delivered: {
          min: 0,
          max: 3,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 4,
        delivered: {
          min: 0,
          max: 4,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  company_hierarchy: {
    id: "company.hierarchy",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 0,
        delivered: 0,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 1,
        delivered: {
          min: 0,
          max: 1,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 1,
        delivered: {
          min: 0,
          max: 1,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  company_icon: {
    id: "company.icon",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "balance",
        cap: 2,
        delivered: {
          min: 0,
          max: 2,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  company_resolve: {
    id: "company.resolve",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 2,
        delivered: {
          min: 0,
          max: 2,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 19,
        delivered: {
          min: 0,
          max: 19,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 21,
        delivered: {
          min: 0,
          max: 21,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 23,
        delivered: {
          min: 0,
          max: 23,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  company_x_account: {
    id: "company.x_account",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 1,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 2,
        delivered: 1.3,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 3,
        delivered: 1.6,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 4,
        delivered: 1.7,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  email_verify: {
    id: "email.verify",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 1,
        delivered: 0.5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 1,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 1.5,
        delivered: 1.5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 1.5,
        delivered: 1.5,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_b2b_social: {
    id: "person.b2b_social",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 3,
        delivered: 2,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 4,
        delivered: 3,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 6,
        delivered: 5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 6,
        delivered: 5,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_email: {
    id: "person.email",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 2,
        delivered: 2,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 2.5,
        delivered: 2.5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 3.5,
        delivered: 3.5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 5,
        delivered: 5,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_language: {
    id: "person.language",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 1,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 3,
        delivered: {
          min: 1,
          max: 3,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 4,
        delivered: {
          min: 1,
          max: 4,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_name: {
    id: "person.name",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 2,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 4,
        delivered: 2,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 5,
        delivered: 3,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 6,
        delivered: 5,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_phone: {
    id: "person.phone",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 10,
        delivered: {
          min: 5,
          max: 10,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 38,
        delivered: {
          min: 5,
          max: 38,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 38,
        delivered: {
          min: 5,
          max: 38,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 58,
        delivered: {
          min: 5,
          max: 58,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_title: {
    id: "person.title",
    byokBasis: "per_answer",
    paths: [
      {
        name: "speed",
        cap: 2,
        delivered: 1,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 4,
        delivered: 2,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 5,
        delivered: 3,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "coverage",
        cap: 6,
        delivered: 5,
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
  person_verify_employment: {
    id: "person.verify_employment",
    byokBasis: "per_billing_hop",
    paths: [
      {
        name: "speed",
        cap: 0.5,
        delivered: 0.5,
        byok: 0.1,
        miss: 0,
      },
      {
        name: "balance",
        cap: 13.5,
        delivered: {
          min: 0.5,
          max: 13.5,
        },
        byok: 0.1,
        miss: 0,
      },
      {
        name: "accuracy",
        cap: 14.5,
        delivered: {
          min: 0.5,
          max: 14.5,
        },
        byok: 0.1,
        miss: 0,
      },
    ],
    optInHops: [],
  },
};
