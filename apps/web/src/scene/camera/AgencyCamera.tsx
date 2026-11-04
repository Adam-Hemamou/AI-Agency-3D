import { useCallback, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { CameraControls, CameraControlsImpl } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import type { RoomId } from '@agency/shared';
import { useAgencyStore } from '../../stores/agencyStore';
import { AGENCY_BOUNDS, ROOM_SIZE, SPACE_PLACEMENTS } from '../layout/agencyLayout';
import {
  CAMERA_DISTANCE,
  ISO_AZIMUTH,
  ISO_POLAR,
  ZOOM_LIMITS,
  fitZoom,
  focalOffsetFor,
  overviewInset,
  panelInset,
  viewOffset,
  type Box3D,
} from './cameraMath';

const { ACTION } = CameraControlsImpl;

const AGENCY_BOX: Box3D = {
  min: [AGENCY_BOUNDS.minX - 0.3, -0.6, AGENCY_BOUNDS.minZ - 0.3],
  max: [AGENCY_BOUNDS.maxX + 0.3, 1.6, AGENCY_BOUNDS.maxZ + 0.3],
};

function roomBox(room: RoomId): Box3D {
  const [cx, cz] = SPACE_PLACEMENTS[room].center;
  const hw = ROOM_SIZE.width / 2 + 0.4;
  const hd = ROOM_SIZE.depth / 2 + 0.4;
  return { min: [cx - hw, 0, cz - hd], max: [cx + hw, 2.3, cz + hd] };
}

/**
 * Caméra isométrique pilotée par camera-controls :
 * glisser (clic gauche) = se déplacer, molette = zoomer, clic droit = pivoter légèrement.
 * Le déplacement est borné à l'agence et les angles sont limités pour ne jamais perdre ses repères.
 */
export function AgencyCamera() {
  const ref = useRef<CameraControlsImpl>(null);
  const size = useThree((s) => s.size);
  const selectedRoom = useAgencyStore((s) => s.selectedRoom);
  const overviewRequest = useAgencyStore((s) => s.overviewRequest);

  const frame = useCallback(
    (
      target: readonly [number, number, number],
      zoom: number,
      focal: { x: number; y: number },
      animate: boolean,
    ) => {
      const c = ref.current;
      if (!c) return;
      const eye = viewOffset()
        .multiplyScalar(CAMERA_DISTANCE)
        .add(new Vector3(...target));
      void c.setLookAt(eye.x, eye.y, eye.z, target[0], target[1], target[2], animate);
      void c.zoomTo(zoom, animate);
      void c.setFocalOffset(focal.x, focal.y, 0, animate);
    },
    [],
  );

  const showOverview = useCallback(
    (animate: boolean) => {
      const inset = overviewInset(size.width);
      const zoom = fitZoom(AGENCY_BOX, size.width - inset.left, size.height, 0.04);
      frame([0, 0, 0], zoom, focalOffsetFor(inset, zoom), animate);
    },
    [frame, size.width, size.height],
  );

  const focusRoom = useCallback(
    (room: RoomId) => {
      const inset = panelInset(size.width, size.height);
      const zoom = fitZoom(
        roomBox(room),
        size.width - inset.right,
        size.height - inset.bottom,
        0.06,
      );
      const [cx, cz] = SPACE_PLACEMENTS[room].center;
      frame([cx, 0.5, cz], zoom, focalOffsetFor(inset, zoom), true);
    },
    [frame, size.width, size.height],
  );

  // Réglages des contrôles, une seule fois.
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // SCREEN_PAN : glisser déplace la vue sur le sol, comme une carte.
    c.mouseButtons.left = ACTION.SCREEN_PAN;
    c.mouseButtons.middle = ACTION.SCREEN_PAN;
    c.mouseButtons.right = ACTION.ROTATE;
    c.mouseButtons.wheel = ACTION.ZOOM;
    c.touches.one = ACTION.TOUCH_SCREEN_PAN;
    c.touches.two = ACTION.TOUCH_ZOOM_TRUCK;
    c.touches.three = ACTION.NONE;
    c.dollyToCursor = true;
    c.minZoom = ZOOM_LIMITS.min;
    c.maxZoom = ZOOM_LIMITS.max;
    c.minPolarAngle = ISO_POLAR - 0.25;
    c.maxPolarAngle = ISO_POLAR + 0.12;
    c.minAzimuthAngle = ISO_AZIMUTH - 0.6;
    c.maxAzimuthAngle = ISO_AZIMUTH + 0.6;
    c.smoothTime = 0.35;
    c.draggingSmoothTime = 0.08;
    c.setBoundary(
      new Box3(
        new Vector3(AGENCY_BOUNDS.minX, -1, AGENCY_BOUNDS.minZ),
        new Vector3(AGENCY_BOUNDS.maxX, 2, AGENCY_BOUNDS.maxZ),
      ),
    );
    showOverview(false);
    // showOverview dépend de la taille : le recadrage au redimensionnement est géré plus bas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sélection d'une salle → cadrage sur la salle ; fermeture → vue d'ensemble.
  useEffect(() => {
    if (selectedRoom) focusRoom(selectedRoom);
    else showOverview(true);
  }, [selectedRoom, overviewRequest, focusRoom, showOverview]);

  return <CameraControls ref={ref} makeDefault />;
}
