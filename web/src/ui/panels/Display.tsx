import { ColorControls } from './ColorControls';
import { FilterControls } from './FilterControls';
import { DetailControls } from './DetailControls';
import { Disclosure } from '../controls/Disclosure';
import { LabelControls } from './LabelControls';
import { LayoutTab } from './LayoutTab';

export function Display() {
  return (
    <>
      <ColorControls />
      <LabelControls />
      <FilterControls />
      <DetailControls />
      <Disclosure title="Layout (advanced)" testId="layout-advanced">
        <LayoutTab />
      </Disclosure>
    </>
  );
}
