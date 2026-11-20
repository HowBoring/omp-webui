import { TYPERT_REMOTE } from "@deepseek-ai/dsh-api-settings-controller/remote";

/** Presentation-only DSH settings surface: no credentials, documents, replace or generic update. */
export const preferencesRemoteContribution = {
  package: TYPERT_REMOTE.package,
  descriptors: TYPERT_REMOTE.descriptors.filter(value => value.namespace === "settings"
    && (value.method === "describe" || value.method === "mutate")),
  methods: {
    "settings/describe": TYPERT_REMOTE.methods["settings/describe"],
    "settings/mutate": TYPERT_REMOTE.methods["settings/mutate"],
  },
};
