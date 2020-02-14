/**
 * Welcome to @reach/listbox!
 *
 * A few notes:
 *
 * Listbox has turned out to be a real test for us in many ways. Primarily, it
 * challenges our desire for maximum composability, a key goal for all of the
 * Reach UI components. A listbox select component essentially consists of:
 *
 *  - A button the user clicks when a listbox is closed
 *  - A list of options in a popover that is displayed after a user clicks
 *
 * This sounds a lot like MenuButton from a UI perspective, but two key
 * differences:
 *
 *  - ListboxOption holds a value, whereas a MenuItem does not
 *  - The ListboxButton rendered result depends on the currently selected
 *    ListboxOption
 *
 * This last point is the kicker! In order for the ListboxButton to know what's
 * going on the the ListboxList, we need to update state in context and store it
 * at the top of the tree. This means we can't show the ListboxButton's inner
 * content on the first render, which means we can't render ListboxButton on
 * the server ... UNLESS the component state is controlled in the app.
 *
 * So in most Reach components, we offer the user the ability to choose between
 * uncontrolled or controlled state. For an uncontrolled component, all you'd
 * have to do is compose the parts and everything just works. AWESOME.
 *
 * We still offer that choice for Listbox, but the concession here is that if
 * you are server rendering your component you may get a server/client mismatch.
 * For this reason, if you are server rendering we always recommend using
 * controlled state for your listbox and explicitly tell the button what to
 * render at the top of the tree.
 *
 * @see Docs     https://reacttraining.com/reach-ui/listbox
 * @see Source   https://github.com/reach/reach-ui/tree/master/packages/listbox
 * @see WAI-ARIA https://www.w3.org/TR/wai-aria-practices-1.1/#Listbox
 */

import React, {
  forwardRef,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import PropTypes from "prop-types";
import { useId } from "@reach/auto-id";
import Popover, { positionMatchWidth } from "@reach/popover";
import {
  createDescendantContext,
  Descendant,
  DescendantProvider,
  useDescendant,
  useDescendants,
} from "@reach/descendants";
import {
  checkStyles,
  createNamedContext,
  forwardRefWithAs,
  isBoolean,
  isFunction,
  isString,
  makeId,
  noop,
  useControlledSwitchWarning,
  useForkedRef,
  useIsomorphicLayoutEffect as useLayoutEffect,
  wrapEvent,
} from "@reach/utils";
import {
  createListboxMachine,
  ListboxEvents,
  ListboxStates,
  unwrapRefs,
  useMachine,
} from "./machine";
import {
  ListboxArrowProps,
  ListboxButtonProps,
  ListboxContextValue,
  ListboxDescendantProps,
  ListboxEvent,
  ListboxGroupContextValue,
  ListboxGroupLabelProps,
  ListboxGroupProps,
  ListboxInputProps,
  ListboxListProps,
  ListboxOptionProps,
  ListboxPopoverProps,
  ListboxProps,
  ListboxValue,
  ListobxButtonRef,
  ListobxInputRef,
  ListobxListRef,
  ListobxOptionRef,
  ListobxPopoverRef,
  MachineToReactRefMap,
} from "./types";

let __DEBUG__ = false;

const expandedStates = [
  ListboxStates.Navigating,
  ListboxStates.NavigatingWithKeys,
  ListboxStates.Interacting,
  ListboxStates.Searching,
];
const isExpanded = (state: ListboxStates) => expandedStates.includes(state);

////////////////////////////////////////////////////////////////////////////////
// ListboxContext

const ListboxDescendantContext = createDescendantContext<
  HTMLElement,
  ListboxDescendantProps
>("ListboxDescendantContext");
const ListboxContext = createNamedContext(
  "ListboxContext",
  {} as ListboxContextValue
);
const ListboxGroupContext = createNamedContext(
  "ListboxGroupContext",
  {} as ListboxGroupContextValue
);
const useDescendantContext = () => useContext(ListboxDescendantContext);
const useListboxContext = () => useContext(ListboxContext);
const useListboxGroupContext = () => useContext(ListboxGroupContext);

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxInput
 *
 * @see Docs https://reacttraining.com/reach-ui/listbox#listboxinput
 */
export const ListboxInput = forwardRef<
  HTMLDivElement,
  ListboxInputProps & { _componentName?: string }
>(function ListboxInput(
  {
    autoComplete,
    children,
    disabled,
    form,
    name,
    onChange,
    required,
    value: valueProp,
    _componentName = "ListboxInput",
    ...props
  },
  forwardedRef
) {
  let isControlled = useRef(valueProp != null);
  let [options, setOptions] = useDescendants<
    HTMLElement,
    ListboxDescendantProps
  >();

  // We will track when a mouse has moved in a ref, then reset it to false each
  // time a popover closes. This is useful because we want the selected value of
  // the listbox to be highlighted when the user opens it, but if the pointer
  // is resting above an option it will steal the highlight.
  let mouseMovedRef = useRef(false);

  // If a user clicks the button while the listbox is open, the blur event
  // will close the popover and send us back to IDLE. The mousup event will
  // then fire and send us right back to NAVIGATING, which we probably don't
  // want. We can probably do this better in the state machine, but for now
  // this ref will track where these mouse events are starting so we can
  // conditionally send events based on this value.
  let mouseEventStartedRef = useRef<false | "listbox" | "button">(false);

  let autocompletePropRef = useRef<typeof autoComplete>(autoComplete);

  let inputRef: ListobxInputRef = useRef(null);
  let buttonRef: ListobxButtonRef = useRef(null);
  let popoverRef: ListobxPopoverRef = useRef(null);
  let listRef: ListobxListRef = useRef(null);

  useLayoutEffect(() => {
    autocompletePropRef.current = autoComplete;
  }, [autoComplete, autocompletePropRef]);

  let machineRefs: MachineToReactRefMap<ListboxEvent> = {
    input: inputRef,
    button: buttonRef,
    popover: popoverRef,
    list: listRef,
  };

  let [current, send] = useMachine(
    createListboxMachine({
      value: valueProp || null,
      isControlled: isControlled.current,
      refs: unwrapRefs(machineRefs),
    }),
    machineRefs
  );

  let _id = useId(props.id);
  let id = props.id || makeId("listbox-input", _id);
  let listboxId = makeId("listbox", id);
  let buttonId = makeId("button", id);

  let ref = useForkedRef(inputRef, forwardedRef);

  let expanded = isExpanded(current.value as ListboxStates);

  // If the button has children, we just render them as the label
  // If a user needs the label on the server to prevent hydration mismatch
  // errors, they need to control the state of the component and pass a label
  // directly to the button.
  let listboxValue = current.context.value;
  let valueLabel = useMemo(() => {
    let selected = options.find(option => option.value === listboxValue);
    return selected ? selected.label : null;
  }, [options, listboxValue]);

  let context: ListboxContextValue = useMemo(() => {
    return {
      buttonId,
      buttonRef,
      disabled: !!disabled,
      inputRef,
      instanceId: id,
      expanded,
      listboxId,
      listboxValue,
      listboxValueLabel: valueLabel,
      listRef,
      mouseEventStartedRef,
      mouseMovedRef,
      onValueChange: onChange,
      popoverRef,
      send,
      state: current,
    };
  }, [
    buttonId,
    current,
    disabled,
    expanded,
    id,
    listboxId,
    listboxValue,
    onChange,
    send,
    valueLabel,
  ]);

  // These props are forwarded to a hidden select field
  let hiddenSelectProps = {
    autoComplete,
    disabled,
    form,
    name,
    required,
  };

  useControlledSwitchWarning(valueProp, "value", _componentName);

  // We need to get some data from props to pass to the state machine in the
  // event that they change
  if (
    isControlled.current &&
    valueProp != null &&
    valueProp !== current.context.value
  ) {
    send({
      type: ListboxEvents.ValueChange,
      value: valueProp,
    });
  }

  useLayoutEffect(() => {
    send({
      type: ListboxEvents.GetDerivedData,
      data: { options },
    });
  }, [options, send]);

  useStateLogger(current.value);
  useEffect(() => checkStyles("listbox"), []);

  return (
    <DescendantProvider
      context={ListboxDescendantContext}
      items={options}
      set={setOptions}
    >
      <ListboxContext.Provider value={context}>
        <div
          {...props}
          ref={ref}
          data-reach-listbox=""
          data-expanded={expanded ? "" : undefined}
          data-state={String(current.value)
            .toLowerCase()
            .replace("_", "-")}
          data-value={current.context.value}
        >
          {isFunction(children)
            ? children({ value: current.context.value, valueLabel })
            : children}
        </div>
        {Object.values(hiddenSelectProps).some(val => val) && (
          <ListboxHiddenSelect {...hiddenSelectProps} />
        )}
      </ListboxContext.Provider>
    </DescendantProvider>
  );
});

if (__DEV__) {
  ListboxInput.displayName = "ListboxInput";
  ListboxInput.propTypes = {
    children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
    autoComplete: PropTypes.string,

    // TODO: Consider autoFocus prop implementation, if possible
    // Not sure how this would work without some sort of App-wrapper provider
    // that manages focus. Inputs get this out of the box, div's do not.
    // autoFocus: PropTypes.bool,
    form: PropTypes.string,
    name: PropTypes.string,
    required: PropTypes.bool,
    value: PropTypes.string,
  };
}

export { ListboxInputProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxHiddenSelect
 *
 * A hidden select field to store values controlled by the listbox.
 * This *should* help with autoComplete (I think, need to test) and is useful if
 * the listbox is used in a form.
 */
const ListboxHiddenSelect: React.FC<React.SelectHTMLAttributes<
  HTMLSelectElement
>> = props => {
  let { descendants: options } = useDescendantContext();
  let { send, state, onValueChange, mouseMovedRef } = useListboxContext();
  return (
    <select
      hidden
      {...props}
      onChange={event => {
        send({
          type: ListboxEvents.ValueChange,
          value: event.target.value,
          callback: val => {
            onValueChange && onValueChange(val);
            mouseMovedRef.current = false;
          },
        });
      }}
      value={state.context.value || undefined}
    >
      {options.map(({ value, label }) => (
        <option value={value} key={value}>
          {label}
        </option>
      ))}
    </select>
  );
};

if (__DEV__) {
  ListboxHiddenSelect.displayName = "ListboxHiddenSelect";
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Listbox
 *
 * @see Docs https://reacttraining.com/reach-ui/listbox#listbox-1
 */
export const Listbox = forwardRef<HTMLDivElement, ListboxProps>(
  function Listbox({ arrow, button, children, ...props }, forwardedRef) {
    return (
      <ListboxInput {...props} _componentName="Listbox" ref={forwardedRef}>
        {({ value, valueLabel }) => (
          <Fragment>
            <ListboxButton
              arrow={arrow}
              children={
                button
                  ? isFunction(button)
                    ? button({ value, label: valueLabel })
                    : button
                  : undefined
              }
            />
            <ListboxPopover>
              <ListboxList>{children}</ListboxList>
            </ListboxPopover>
          </Fragment>
        )}
      </ListboxInput>
    );
  }
);

if (__DEV__) {
  Listbox.displayName = "Listbox";
  Listbox.propTypes = {
    ...ListboxInput.propTypes,
    arrow: PropTypes.oneOfType([PropTypes.node, PropTypes.bool]),
    button: PropTypes.oneOfType([PropTypes.func, PropTypes.node]),
  };
}

export { ListboxProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxButton
 */
export const ListboxButton = forwardRefWithAs<ListboxButtonProps, "button">(
  function ListboxButton(
    {
      arrow = false,
      as: Comp = "button",
      children,
      onBlur,
      onMouseDown,
      onMouseUp,
      onKeyDown,
      ...props
    },
    forwardedRef
  ) {
    let { descendants: options } = useDescendantContext();
    let {
      buttonId,
      buttonRef,
      expanded,
      listboxId,
      mouseEventStartedRef,
      state,
      send,
    } = useListboxContext();
    let listboxValue = state.context.value;

    let ref = useForkedRef(buttonRef, forwardedRef);

    let handleKeyDown = useKeyDown();

    function handleMouseDown(event: React.MouseEvent) {
      mouseEventStartedRef.current = "button";
      event.persist();
      send({
        type: ListboxEvents.ButtonPointerDown,
        isRightClick: isRightClick(event.nativeEvent),
        domEvent: event.nativeEvent,
      });
    }

    function handleMouseUp(event: React.MouseEvent) {
      if (mouseEventStartedRef.current === "button") {
        send({
          type: ListboxEvents.ButtonFinishClick,
          isRightClick: isRightClick(event.nativeEvent),
        });
      }
      mouseEventStartedRef.current = false;
    }

    let getLabelFromContext = useCallback(
      function getLabelFromContext() {
        let selected = options.find(option => option.value === listboxValue);
        return selected ? selected.label : "";
      },
      [options, listboxValue]
    );

    //let handleBlur = useBlur();

    // If the button has children, we just render them as the label
    // If a user needs the label on the server to prevent hydration mismatch
    // errors, they need to control the state of the component and pass a label
    // directly to the button.
    let label: React.ReactNode = useMemo(() => {
      if (!children) {
        return getLabelFromContext();
      } else if (isFunction(children)) {
        return children({
          isExpanded: expanded,
          label: getLabelFromContext(),
          value: listboxValue,
        });
      }
      return children;
    }, [children, getLabelFromContext, expanded, listboxValue]);

    return (
      <Comp
        aria-controls={listboxId}
        aria-expanded={expanded}
        aria-haspopup="listbox"
        aria-labelledby={`${buttonId} ${listboxId}`}
        {...props}
        ref={ref}
        data-reach-listbox-button=""
        id={buttonId}
        //onBlur={wrapEvent(onBlur, handleBlur)}
        onKeyDown={wrapEvent(onKeyDown, handleKeyDown)}
        onMouseDown={wrapEvent(onMouseDown, handleMouseDown)}
        onMouseUp={wrapEvent(onMouseUp, handleMouseUp)}
      >
        {label}
        {arrow && (
          <ListboxArrow>{!isBoolean(arrow) ? arrow : null}</ListboxArrow>
        )}
      </Comp>
    );
  }
);

if (__DEV__) {
  ListboxButton.displayName = "ListboxButton";
  ListboxButton.propTypes = {
    arrow: PropTypes.oneOfType([PropTypes.node, PropTypes.bool]),
    children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  };
}

export { ListboxButtonProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxArrow
 *
 * @see Docs https://reacttraining.com/reach-ui/listbox#listboxarrow
 */
export const ListboxArrow = forwardRef<HTMLSpanElement, ListboxArrowProps>(
  function ListboxArrow({ children, ...props }, forwardedRef) {
    let { expanded } = useListboxContext();
    let defaultArrow = expanded ? "▲" : "▼";
    return (
      <span
        aria-hidden
        {...props}
        ref={forwardedRef}
        data-reach-listbox-arrow=""
      >
        {isFunction(children)
          ? children({ isExpanded: expanded })
          : children || defaultArrow}
      </span>
    );
  }
);

if (__DEV__) {
  ListboxArrow.displayName = "ListboxArrow";
  ListboxArrow.propTypes = {};
}

export { ListboxArrowProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxPopover
 */
export const ListboxPopover = forwardRef<any, ListboxPopoverProps>(
  function ListboxPopover(
    {
      position = positionMatchWidth,
      onBlur,
      onKeyDown,
      portal = true,
      ...props
    },
    forwardedRef
  ) {
    let { expanded, popoverRef, buttonRef } = useListboxContext();
    let ref = useForkedRef(popoverRef, forwardedRef);
    let hidden = !expanded;

    let handleKeyDown = useKeyDown();
    let handleBlur = useBlur();

    let commonProps = {
      ...props,
      ref,
      "data-reach-listbox-popover": "",
      hidden,
      onBlur: wrapEvent(onBlur, handleBlur),
      onKeyDown: wrapEvent(onKeyDown, handleKeyDown),
      tabIndex: -1,
    };

    return portal ? (
      <Popover
        {...commonProps}
        targetRef={buttonRef as any}
        position={position}
      />
    ) : (
      <div {...commonProps} />
    );
  }
);

if (__DEV__) {
  ListboxPopover.displayName = "ListboxPopover";
  ListboxPopover.propTypes = {
    portal: PropTypes.bool,
    children: PropTypes.node,
  };
}

export { ListboxPopoverProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxList
 */
export const ListboxList = forwardRefWithAs<ListboxListProps, "ul">(
  function ListboxList({ as: Comp = "ul", ...props }, forwardedRef) {
    let {
      listRef,
      listboxId,
      state: {
        context: { value },
      },
    } = useListboxContext();
    let ref = useForkedRef(forwardedRef, listRef);

    return (
      <Comp
        aria-activedescendant={useOptionId(value)}
        role="listbox"
        {...props}
        ref={ref}
        data-reach-listbox-list=""
        id={listboxId}
        tabIndex={-1}
      />
    );
  }
);

if (__DEV__) {
  ListboxList.displayName = "ListboxList";
  ListboxList.propTypes = {};
}

export { ListboxListProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxOption
 */
export const ListboxOption = forwardRefWithAs<ListboxOptionProps, "li">(
  function ListboxOption(
    {
      as: Comp = "li",
      children,
      onMouseDown,
      onMouseEnter,
      onMouseLeave,
      onMouseMove,
      onMouseUp,
      value,
      label: labelProp,
      ...props
    },
    forwardedRef
  ) {
    if (__DEV__) {
      if (!value) {
        throw Error(`A ListboxOption must have a value prop.`);
      }
    }

    let {
      send,
      state: {
        value: state,
        context: { value: listboxValue, navigationValue },
      },
      onValueChange,
      mouseEventStartedRef,
      mouseMovedRef,
    } = useListboxContext();

    let [labelState, setLabel] = useState(labelProp);
    let label = labelProp || labelState || "";

    let ownRef: ListobxOptionRef = useRef(null);
    useDescendant({
      context: ListboxDescendantContext,
      element: ownRef.current!,
      value,
      label,
    });

    // After the ref is mounted to the DOM node, we check to see if we have an
    // explicit label prop before looking for the node's textContent for
    // typeahead functionality.
    let getLabelFromDomNode = useCallback(
      (node: HTMLElement) => {
        if (!labelProp) {
          setLabel(prevState => {
            if (node.textContent && prevState !== node.textContent) {
              return node.textContent;
            }
            return prevState || "";
          });
        }
      },
      [labelProp]
    );
    let ref = useForkedRef(getLabelFromDomNode, forwardedRef, ownRef);

    let isHighlighted = navigationValue ? navigationValue === value : false;
    let isSelected = listboxValue === value;

    function handleMouseEnter() {
      // If the user hasn't moved their mouse but mouse enter event still fires
      // (this happens if the popup opens due to a keyboard event), we don't
      // want to change the navigationSelect value
      if (mouseMovedRef.current) {
        send({
          type: ListboxEvents.Navigate,
          value,
          node: ownRef.current!,
        });
      }
    }

    function handleMouseLeave() {
      send({
        type: ListboxEvents.ClearNavSelection,
      });
    }

    function handleMouseDown(event: React.MouseEvent) {
      mouseEventStartedRef.current = "listbox";
      send({
        type: ListboxEvents.OptionStartClick,
        isRightClick: isRightClick(event.nativeEvent),
      });
    }

    function handleMouseUp(event: React.MouseEvent) {
      if (mouseEventStartedRef.current) {
        mouseEventStartedRef.current = false;
        send({
          type: ListboxEvents.OptionFinishClick,
          value,
          isRightClick: isRightClick(event.nativeEvent),
          callback: onValueChange,
        });
      }
    }

    function handleMouseMove() {
      mouseMovedRef.current = true;
      // We don't really *need* this guard if we put this in the state machine,
      // but in this case it seems wise not to needlessly run our transitions
      // every time the user's mouse moves. Seems like a lot.
      if (state === ListboxStates.Navigating) {
        send({
          type: ListboxEvents.Navigate,
          value,
        });
      }
    }

    return (
      <Comp
        aria-selected={isSelected}
        role="option"
        {...props}
        ref={ref}
        id={useOptionId(value)}
        data-reach-listbox-option=""
        data-highlighted={isHighlighted ? "" : undefined}
        data-label={label}
        data-value={value}
        //onClick={wrapEvent(onClick, handleClick)}
        onMouseDown={wrapEvent(onMouseDown, handleMouseDown)}
        onMouseEnter={wrapEvent(onMouseEnter, handleMouseEnter)}
        onMouseLeave={wrapEvent(onMouseLeave, handleMouseLeave)}
        onMouseMove={wrapEvent(onMouseMove, handleMouseMove)}
        onMouseUp={wrapEvent(onMouseUp, handleMouseUp)}
        tabIndex={-1}
      >
        {children}
      </Comp>
    );
  }
);

if (__DEV__) {
  ListboxOption.displayName = "ListboxOption";
  ListboxOption.propTypes = {
    value: PropTypes.string.isRequired,
    label: PropTypes.string,
  };
}

export { ListboxOptionProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxGroup
 */
export const ListboxGroup = forwardRef<HTMLDivElement, ListboxGroupProps>(
  function ListboxGroup({ ...props }, forwardedRef) {
    const { listboxId } = useListboxContext();
    const labelId = makeId("label", useId(props.id), listboxId);
    return (
      <ListboxGroupContext.Provider value={{ labelId }}>
        <div
          aria-labelledby={labelId}
          role="group"
          {...props}
          ref={forwardedRef}
        />
      </ListboxGroupContext.Provider>
    );
  }
);

if (__DEV__) {
  ListboxGroup.displayName = "ListboxGroup";
  ListboxGroup.propTypes = {};
}

export { ListboxGroupProps };

////////////////////////////////////////////////////////////////////////////////

/**
 * ListboxGroupLabel
 */
export const ListboxGroupLabel = forwardRefWithAs<
  ListboxGroupLabelProps,
  "span"
>(function ListboxGroupLabel({ as: Comp = "span", ...props }, forwardedRef) {
  const { labelId } = useListboxGroupContext();
  return (
    <Comp
      role="none"
      {...props}
      ref={forwardedRef}
      data-reach-listbox-group-label=""
      id={labelId}
    />
  );
});

if (__DEV__) {
  ListboxGroupLabel.displayName = "ListboxGroupLabel";
  ListboxGroupLabel.propTypes = {};
}

export { ListboxGroupLabelProps };

////////////////////////////////////////////////////////////////////////////////

function useBlur() {
  const { send, mouseEventStartedRef } = useListboxContext();
  return function handleBlur(event: React.FocusEvent) {
    let { nativeEvent } = event;
    requestAnimationFrame(() => {
      mouseEventStartedRef.current = "listbox";
      send({
        type: ListboxEvents.Blur,
        domEvent: nativeEvent,
      });
    });
  };
}

function useKeyDown() {
  const {
    onValueChange,
    state: {
      context: { navigationValue, typeaheadQuery },
    },
    popoverRef,
    send,
  } = useListboxContext();

  let { descendants: options } = useContext(ListboxDescendantContext);

  useEffect(() => {
    let timeout = setTimeout(() => {}, 2000);
    return () => {
      clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (typeaheadQuery) {
      send({
        type: ListboxEvents.UpdateAfterTypeahead,
        query: typeaheadQuery,
        callback: onValueChange,
      });
    }
    let timeout = window.setTimeout(() => {
      if (typeaheadQuery != null) {
        send({ type: ListboxEvents.ClearTypeahead });
      }
    }, 1000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [onValueChange, send, typeaheadQuery]);

  return function handleKeyDown(event: React.KeyboardEvent) {
    // event.persist();
    let { key, nativeEvent } = event;
    let isSearching = isString(key) && key.length === 1;
    let navIndex = options.findIndex(({ value }) => value === navigationValue);
    let atBottom = navIndex === options.length - 1;
    let atTop = navIndex === 0;
    let noSelection = navIndex < 0;
    let nextIndex: number;

    switch (key) {
      case "Enter":
        send({
          type: ListboxEvents.KeyDownEnter,
          value: navigationValue,
          domEvent: nativeEvent,
          callback: onValueChange,
          disabled: false,
        });
        return;
      case " ":
        send({
          type: ListboxEvents.KeyDownSpace,
          value: navigationValue,
          domEvent: nativeEvent,
          callback: onValueChange,
          disabled: false,
        });
        return;
      case "Escape":
        send({
          type: ListboxEvents.KeyDownEscape,
        });
        return;
      case "Tab":
        let eventType = event.shiftKey
          ? ListboxEvents.KeyDownShiftTab
          : ListboxEvents.KeyDownTab;
        send({ type: eventType });
        return;
      case "Home":
        event.preventDefault();
        nextIndex = 0;
        return;
      case "End":
        event.preventDefault();
        nextIndex = options.length - 1;
        break;
      case "ArrowUp":
        event.preventDefault();
        nextIndex = atTop
          ? options.length - 1
          : noSelection
          ? options.length - 1
          : (navIndex - 1 + options.length) % options.length;
        break;
      case "ArrowDown":
        event.preventDefault();
        nextIndex = atBottom
          ? 0
          : noSelection
          ? 0
          : (navIndex + 1) % options.length;
        break;
      default:
        if (isSearching) {
          send({
            type: ListboxEvents.KeyDownSearch,
            query: key,
          });
        }
        return;
    }
    send({
      type: ListboxEvents.KeyDownNavigate,
      value: options[nextIndex].value,
      node: options[nextIndex].element,
    });
  };
}

function useOptionId(value: ListboxValue | null) {
  const { instanceId } = useListboxContext();
  return value ? makeId(`option-${value}`, instanceId) : "";
}

function isRightClick(nativeEvent: MouseEvent) {
  return nativeEvent.which === 3 || nativeEvent.button === 2;
}

function useStateLogger(state: string) {
  let effect = noop;
  if (__DEV__ && __DEBUG__) {
    effect = function() {
      console.group("State Updated");
      console.log(
        "%c" + state,
        "font-weight: normal; font-size: 120%; font-style: italic;"
      );
      console.groupEnd();
    };
  }
  useEffect(effect, [state]);
}
