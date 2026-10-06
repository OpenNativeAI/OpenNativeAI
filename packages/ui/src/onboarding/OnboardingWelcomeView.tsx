import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { OpenNativeAIAboutLogo } from "@/components/ui/OpenNativeAIAboutLogo.js";
import { useOpenNativeAIIntl } from "@/i18n/IntlProvider.js";
import { OnboardingWelcomeAsciiVisual } from "@/onboarding/OnboardingWelcomeAsciiVisual.js";

export function OnboardingWelcomeView(props: { onStart: () => void; onOpenMigration: () => void }) {
  const { intl } = useOpenNativeAIIntl();

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-1/2 flex-col px-8 py-8">
        <div className="space-y-6">
          <div className="inline-flex items-center rounded-full border border-border bg-background-alt px-3 py-1 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "onboarding.welcome.eyebrow" })}
          </div>

          <div className="space-y-2">
            <div
              className="flex size-16 items-center justify-center"
              aria-label="OpenNativeAI"
              role="img"
            >
              <OpenNativeAIAboutLogo className="size-16" />
            </div>
            <div className="text-4xl font-bold tracking-tight text-foreground">
              {intl.formatMessage({ id: "onboarding.welcome.title" })}
            </div>
          </div>
        </div>

        <div className="flex flex-1 items-center">
          <div className="w-full space-y-4">
            <Button
              type="button"
              size="lg"
              className="h-10 w-full justify-between text-ui-base"
              onClick={props.onStart}
            >
              {intl.formatMessage({ id: "onboarding.welcome.start" })}
              <ArrowRightIcon className="size-4" />
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-10 w-full justify-between text-ui-base"
              onClick={props.onOpenMigration}
            >
              {intl.formatMessage({ id: "onboarding.welcome.migrate" })}
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        <div className="pt-6 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "onboarding.welcome.helper" })}
        </div>
      </div>

      <div className="flex w-1/2 flex-col p-2 pl-0">
        <OnboardingWelcomeAsciiVisual />
      </div>
    </div>
  );
}
