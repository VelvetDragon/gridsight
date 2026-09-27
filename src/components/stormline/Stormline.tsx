"use client";

import dynamic from "next/dynamic";
import { CloudLightning, Layers, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useUrlParam } from "@/lib/useUrlState";
import type { MapPadding } from "../map/MapCanvas";
import { StormScrubber } from "../response/StormScrubber";
import { LayerKey } from "../response/LayerKey";
import { useResponseMode } from "../response/useResponseMode";
import { AppShell, NAV_CLEARANCE } from "../shell/AppShell";
import { NAV } from "../shell/nav";
import { Rail, railInset, type RailSection } from "../shell/Rail";
import { ErrorCard } from "../ui/states";
import { StormBriefingButton } from "../integrations/StormBriefingButton";
import { StormWatch } from "./StormWatch";
import { panelInset, TeamUpPanel } from "./TeamUpSection";
import { StormAgent } from "./StormAgent";
import { Block, BothGridsLine, CrewsSection, ModelCheck, More, RealOutages, StormPicker, TimeSavedBlock } from "./StormSections";

const MapStage = dynamic(() => import("../map/MapStage"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-paper" />,
});

const SCRUBBER_H = 72;

/** Stormline: where the next storm meets both grids. */
export function Stormline() {
  const stormParam = useUrlParam("storm");
  const timeParam = useUrlParam("t");
  const response = useResponseMode(stormParam, timeParam);
  // Both panels start closed: the map and "Ask MrGridy" first; the agent or a click opens them.
  const [open, setOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamMove, setTeamMove] = useState<string | null>(null);
  const scene = useMemo(
    () => (response.scene ? { ...response.scene, selectedTeamMove: teamMove } : null),
    [response.scene, teamMove],
  );
  const [active, setActive] = useState("storm");
  const { clearZone } = response;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clearZone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearZone]);

  const padding = useMemo<MapPadding>(
    () => ({ top: NAV_CLEARANCE + 16, bottom: SCRUBBER_H + 40, left: railInset(open), right: panelInset(teamOpen) }),
    [open, teamOpen],
  );

  const data = response.data;
  const sections: RailSection[] = [
    {
      id: "storm",
      label: "The storm",
      icon: <CloudLightning size={15} aria-hidden />,
      content: (
        <>
          <Block>
            <StormWatch />
          </Block>
          <Block>
            <StormPicker storms={response.storms} stormId={response.stormId} onStorm={response.pickStorm} />
          </Block>
          {data ? (
            <>
              <Block>
                <BothGridsLine data={data} />
                {response.stormId ? <StormBriefingButton stormId={response.stormId} className="mt-4" /> : null}
              </Block>
              {data.mutualAid ? (
                <Block>
                  <TimeSavedBlock data={data} />
                </Block>
              ) : null}
              {response.stormId ? (
                <Block>
                  <RealOutages stormId={response.stormId} />
                </Block>
              ) : null}
              <Block>
                <More label="How good is the model?">
                  <ModelCheck data={data} stormId={response.stormId} />
                </More>
              </Block>
            </>
          ) : (
            <Block>
              <div className="gs-skeleton h-16" />
            </Block>
          )}
        </>
      ),
    },
    {
      id: "crews",
      label: "Crews",
      icon: <Wrench size={15} aria-hidden />,
      content: data ? (
        <CrewsSection
          data={data}
          selectedZoneId={response.selectedZoneId}
          onZone={response.selectZone}
          onYard={response.flyToYard}
        />
      ) : null,
    },
    {
      id: "key",
      label: "Map key",
      icon: <Layers size={15} aria-hidden />,
      content: (
        <LayerKey
          visible={response.visible}
          onToggle={response.toggleLayer}
          hasActuals={!!data?.counties.some((c) => c.actualPeakOut != null)}
        />
      ),
    },
  ];

  return (
    <AppShell>
      <main className="relative h-dvh w-full overflow-hidden bg-paper">
        <MapStage
          mode="response"
          plan={null}
          response={scene}
          popup={null}
          view={response.view}
          padding={padding}
        />
        <Rail
          title={NAV[2].name}
          tagline={NAV[2].tagline}
          sections={sections}
          active={active}
          onActive={setActive}
          open={open}
          onOpen={setOpen}
        />
        <StormAgent
          bridge={{
            storms: response.storms,
            stormId: response.stormId,
            data: data ?? null,
            loading: response.loading,
            pickStorm: response.pickStorm,
            selectZone: response.selectZone,
            flyToPoints: response.flyToPoints,
            selectTeamMove: setTeamMove,
            openTeamPanel: () => setTeamOpen(true),
            showSection: (id) => {
              setOpen(true);
              setActive(id);
            },
            times: response.times,
            replay: response.replay,
            visible: response.visible,
            toggleLayer: response.toggleLayer,
            reveal: response.scene?.reveal ?? null,
          }}
        />
        <TeamUpPanel
          data={data ?? null}
          onFly={response.flyToPoints}
          open={teamOpen}
          onOpen={setTeamOpen}
          selected={teamMove}
          onSelect={setTeamMove}
        />
        {data && response.times.length > 1 ? (
          <div
            className="fixed z-20"
            style={{ left: railInset(open) - 12, right: panelInset(teamOpen) - 12, bottom: 34, transition: "left 220ms ease, right 220ms ease" }}
          >
            <div className="mx-auto max-w-[820px]">
              <StormScrubber
                storm={data.storm}
                times={response.times}
                value={response.replay.value}
                playing={response.replay.playing}
                onSeek={response.replay.seek}
                onToggle={response.replay.toggle}
              />
            </div>
          </div>
        ) : null}
        {response.error ? <ErrorCard message={response.error.message} onRetry={response.error.retry} /> : null}
      </main>
    </AppShell>
  );
}
