import { ColorControls } from './ColorControls';
import { FilterControls } from './FilterControls';
import { DetailControls } from './DetailControls';
import { LabelControls } from './LabelControls';

export function Display() {
  return (
    <>
      <ColorControls />
      <LabelControls />
      <FilterControls />
      <DetailControls />
    </>
  );
}
